"""
Forge Fitness backend.

Provides:
- Flask API for member CRUD, notifications, activity, and stats
- Supabase support when a valid service-role key is configured
- Automatic SQLite fallback for local development and recovery
- Optional SMTP reminder emails
- Daily scheduled reminder job
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import smtplib
import sqlite3
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import razorpay
import schedule
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from supabase import Client, create_client


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("forge-fitness")


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
SQLITE_PATH = Path(
    os.getenv("SQLITE_PATH", str(BASE_DIR / "forgefitness.db"))
).expanduser().resolve()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mpakawelhqypmkqzwmub.supabase.co").strip()
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wYWthd2VsaHF5cG1rcXp3bXViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODM0MTYwMywiZXhwIjoyMDkzOTE3NjAzfQ.Yvg7y7z3yZ3kgWffXKWlLGktwPRlk1eJB_01OBH6SW0").strip()
SMTP_HOST = os.getenv("SMTP_HOST", "forgefitness2026@gmail.com").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASS = os.getenv("SMTP_PASS", "").strip()
GYM_NAME = os.getenv("GYM_NAME", "IronCore Gym").strip()
GYM_EMAIL = os.getenv("GYM_EMAIL", "forgefitness2026@gmail.com").strip()
FLASK_SECRET = os.getenv("FLASK_SECRET", "dev-secret").strip()
PORT = int(os.getenv("PORT", "5000"))
DATABASE_BACKEND = os.getenv("DATABASE_BACKEND", "auto").strip().lower()

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "").strip()


app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
app.secret_key = FLASK_SECRET
CORS(app)


def error_response(message: str, status_code: int = 400):
    return jsonify({"ok": False, "error": message}), status_code


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_placeholder(value: str) -> bool:
    lowered = (value or "").strip().lower()
    if not lowered:
        return True
    placeholder_tokens = (
        "your-",
        "your_",
        "your ",
        "replace",
        "example",
        "placeholder",
        "change-me",
        "changeme",
    )
    return any(token in lowered for token in placeholder_tokens)


def has_valid_supabase_service_key() -> bool:
    return bool(
        SUPABASE_URL
        and SUPABASE_SERVICE_KEY
        and not is_placeholder(SUPABASE_SERVICE_KEY)
        and SUPABASE_SERVICE_KEY.startswith("eyJ")
    )


def looks_like_publishable_supabase_key(value: str) -> bool:
    lowered = (value or "").strip().lower()
    return lowered.startswith("sb_publishable_") or lowered.startswith("sb_anon_")


def build_initial_password(member_name: str) -> str:
    cleaned_name = " ".join((member_name or "").split()).strip()
    if not cleaned_name:
        return "member1"

    password = cleaned_name
    while len(password) < 6:
        password += cleaned_name
    return password[: max(6, len(cleaned_name))]


def smtp_is_configured() -> bool:
    return bool(
        SMTP_HOST
        and SMTP_USER
        and SMTP_PASS
        and not is_placeholder(SMTP_USER)
        and not is_placeholder(SMTP_PASS)
    )


def sqlite_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_sqlite():
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS members (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE,
              auth_user_id TEXT UNIQUE,
              phone TEXT,
              plan TEXT NOT NULL CHECK (plan IN ('Monthly', 'Quarterly', 'Annual')),
              membership_type TEXT NOT NULL DEFAULT 'Strength Training',
              due_date TEXT NOT NULL,
              join_date TEXT NOT NULL,
              notes TEXT,
              emergency_contact TEXT,
              health_notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notifications (
              id TEXT PRIMARY KEY,
              member_id TEXT NOT NULL,
              member_name TEXT,
              member_email TEXT,
              due_date TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
              sent_at TEXT,
              created_at TEXT NOT NULL,
              UNIQUE (member_id, due_date),
              FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS activity_log (
              id TEXT PRIMARY KEY,
              action TEXT NOT NULL,
              detail TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_members_due_date ON members(due_date);
            CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
            """
        )
        # Ensure the members table includes auth_user_id for older local databases.
        columns = [row[1] for row in conn.execute("PRAGMA table_info(members)").fetchall()]
        if "auth_user_id" not in columns:
            conn.execute("ALTER TABLE members ADD COLUMN auth_user_id TEXT")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_members_auth_user_id ON members(auth_user_id)")


init_sqlite()

supabase: Client | None = None
supabase_admin_client: Client | None = None
DATABASE_MODE = "sqlite"

if has_valid_supabase_service_key():
    try:
        supabase_admin_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        log.info("Supabase admin client initialised.")
        if DATABASE_BACKEND in {"auto", "supabase"}:
            supabase = supabase_admin_client
            DATABASE_MODE = "supabase"
            log.info("Supabase database client initialised.")
    except Exception as exc:
        log.warning("Supabase init failed. Falling back to SQLite-only mode: %s", exc)
elif DATABASE_BACKEND == "supabase":
    log.warning("Supabase mode was requested but no valid service-role key was found. Using SQLite.")
elif looks_like_publishable_supabase_key(SUPABASE_SERVICE_KEY):
    log.warning("SUPABASE_SERVICE_KEY appears to be a publishable/anon key. Member portal accounts cannot be auto-created.")
else:
    log.info("Using SQLite database at %s", SQLITE_PATH)

if DATABASE_MODE == "sqlite":
    log.info("SQLite database ready at %s", SQLITE_PATH)


def failover_to_sqlite(reason: str, exc: Exception | None = None):
    global supabase, DATABASE_MODE

    if DATABASE_MODE == "sqlite":
        return

    if exc:
        log.warning("Switching database backend to SQLite because %s: %s", reason, exc)
    else:
        log.warning("Switching database backend to SQLite because %s", reason)

    supabase = None
    DATABASE_MODE = "sqlite"


def humanize_database_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    lowered = message.lower()

    duplicate_markers = (
        "duplicate key",
        "unique constraint",
        "already exists",
        "members_email_key",
        "unique violation",
    )
    if any(marker in lowered for marker in duplicate_markers):
        return "A member with this email already exists."

    timeout_markers = (
        "timed out",
        "connecterror",
        "connecttimeout",
        "readtimeout",
        "unreachable host",
        "getaddrinfo failed",
        "socket operation was attempted",
    )
    if any(marker in lowered for marker in timeout_markers):
        return "The database connection timed out. The server has switched to local mode. Please try again."

    return message


razorpay_client = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET and not is_placeholder(RAZORPAY_KEY_ID) and not is_placeholder(RAZORPAY_KEY_SECRET):
    try:
        razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    except Exception as exc:
        log.warning("Failed to initialise Razorpay client: %s", exc)
else:
    log.warning("Razorpay credentials are missing or placeholders. Payment endpoints will stay disabled.")


def require_database():
    if supabase or SQLITE_PATH.exists():
        return None
    return error_response("No database backend is available.", 503)


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def parse_date(value: str, field_name: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except Exception as exc:
        raise ValueError(f"{field_name} must be a valid YYYY-MM-DD date.") from exc


def safe_member_payload(payload: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    allowed_fields = {
        "name",
        "email",
        "phone",
        "plan",
        "membership_type",
        "due_date",
        "join_date",
        "notes",
        "emergency_contact",
        "health_notes",
    }
    cleaned: dict[str, Any] = {}

    for key in allowed_fields:
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, str):
            value = value.strip()
        cleaned[key] = value

    if not partial:
        for required in ("name", "email", "plan", "membership_type", "due_date"):
            if not cleaned.get(required):
                raise ValueError(f"{required} is required.")

    if "email" in cleaned and cleaned["email"]:
        cleaned["email"] = cleaned["email"].lower()

    if "plan" in cleaned and cleaned["plan"]:
        valid_plans = {"Monthly", "Quarterly", "Annual"}
        if cleaned["plan"] not in valid_plans:
            raise ValueError("plan must be Monthly, Quarterly, or Annual.")

    if "due_date" in cleaned and cleaned["due_date"]:
        cleaned["due_date"] = parse_date(cleaned["due_date"], "due_date")

    if "join_date" in cleaned and cleaned["join_date"]:
        cleaned["join_date"] = parse_date(cleaned["join_date"], "join_date")

    return cleaned


def serialize_member(member: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": member.get("id"),
        "name": member.get("name"),
        "email": member.get("email"),
        "auth_user_id": member.get("auth_user_id"),
        "phone": member.get("phone"),
        "plan": member.get("plan"),
        "membership_type": member.get("membership_type"),
        "due_date": member.get("due_date"),
        "join_date": member.get("join_date"),
        "notes": member.get("notes"),
        "emergency_contact": member.get("emergency_contact"),
        "health_notes": member.get("health_notes"),
        "created_at": member.get("created_at"),
        "updated_at": member.get("updated_at"),
    }


def serialize_notification(notification: dict[str, Any]) -> dict[str, Any]:
    member = notification.get("members") or {}
    return {
        "id": notification.get("id"),
        "member_id": notification.get("member_id"),
        "member_name": notification.get("member_name") or member.get("name"),
        "member_email": notification.get("member_email") or member.get("email"),
        "due_date": notification.get("due_date"),
        "status": notification.get("status"),
        "sent_at": notification.get("sent_at"),
        "created_at": notification.get("created_at"),
    }


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def add_activity(detail: str, action: str):
    entry = {
        "id": str(uuid.uuid4()),
        "action": action,
        "detail": detail,
        "created_at": utcnow_iso(),
    }

    if supabase:
        try:
            supabase.table("activity_log").insert(
                {"action": action, "detail": detail}
            ).execute()
            return
        except Exception as exc:
            log.warning("Failed to write activity to Supabase: %s", exc)

    with sqlite_connection() as conn:
        conn.execute(
            """
            INSERT INTO activity_log (id, action, detail, created_at)
            VALUES (:id, :action, :detail, :created_at)
            """,
            entry,
        )


def fetch_activity(limit: int = 30) -> list[dict[str, Any]]:
    if supabase:
        try:
            response = (
                supabase.table("activity_log")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            failover_to_sqlite("Supabase activity query failed", exc)

    with sqlite_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, action, detail, created_at
            FROM activity_log
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def build_email_html(member_name: str, due_date: str, plan: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body  {{ font-family: Arial, sans-serif; background:#f5f5f5; margin:0; padding:0; }}
  .wrap {{ max-width:520px; margin:40px auto; background:#fff; border-radius:6px; overflow:hidden;
           box-shadow: 0 4px 20px rgba(0,0,0,0.08); }}
  .hdr  {{ background:#0a0a0a; padding:28px 32px; text-align:center; }}
  .hdr h1 {{ color:#e8ff00; font-size:28px; letter-spacing:6px; margin:0; font-family:'Courier New',monospace; }}
  .body {{ padding:32px; }}
  .body h2 {{ font-size:18px; color:#111; margin-bottom:12px; }}
  .body p  {{ color:#555; line-height:1.6; font-size:14px; }}
  .due-box {{ background:#fff3cd; border:1px solid #ffc107; border-radius:4px; padding:16px 20px; margin:20px 0; text-align:center; }}
  .due-box .label {{ font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#888; margin-bottom:4px; }}
  .due-box .date  {{ font-size:26px; font-weight:700; color:#e65100; }}
  .cta  {{ display:block; text-align:center; background:#0a0a0a; color:#e8ff00; padding:14px 28px; border-radius:4px; text-decoration:none; font-weight:700; margin:24px 0; letter-spacing:2px; font-size:14px; }}
  .ftr  {{ background:#f0f0f0; padding:16px 32px; text-align:center; font-size:11px; color:#999; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr"><h1>{GYM_NAME}</h1></div>
  <div class="body">
    <h2>Hey {member_name}, your membership renews soon.</h2>
    <p>Your <strong>{plan}</strong> membership is due in just <strong>2 days</strong>.</p>
    <div class="due-box">
      <div class="label">Renewal Due Date</div>
      <div class="date">{due_date}</div>
    </div>
    <p>If you have already paid, please ignore this message. For help, contact <a href="mailto:{GYM_EMAIL}">{GYM_EMAIL}</a>.</p>
    <a href="mailto:{GYM_EMAIL}?subject=Membership Renewal" class="cta">RENEW MY MEMBERSHIP</a>
  </div>
  <div class="ftr">Copyright {date.today().year} {GYM_NAME}</div>
</div>
</body>
</html>
""".strip()


def send_email(to_address: str, to_name: str, due_date: str, plan: str) -> bool:
    if not smtp_is_configured():
        log.warning("[DRY RUN] Email skipped for %s because SMTP is not configured.", to_address)
        return True

    subject = f"Membership renewal due in 2 days - {GYM_NAME}"
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = f"{GYM_NAME} <{SMTP_USER}>"
    message["To"] = f"{to_name} <{to_address}>"
    message.attach(MIMEText(build_email_html(to_name, due_date, plan), "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_address, message.as_string())
        log.info("Email sent to %s", to_address)
        return True
    except Exception as exc:
        log.error("Email failed for %s: %s", to_address, exc)
        return False


def send_welcome_email(to_address: str, to_name: str, password: str) -> bool:
    if not smtp_is_configured():
        log.warning("[DRY RUN] Welcome email skipped for %s because SMTP is not configured.", to_address)
        return True

    subject = f"Welcome to {GYM_NAME} — your member portal access"
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = f"{GYM_NAME} <{SMTP_USER}>"
    message["To"] = f"{to_name} <{to_address}>"

    plain = f"Hello {to_name or ''},\n\nAn account has been created for you on {GYM_NAME} member portal.\n\nEmail: {to_address}\nTemporary password: {password}\n\nPlease sign in and change your password.\n\nThanks,\n{GYM_NAME}\n"
    html = f"<html><body><p>Hello {to_name or ''},</p><p>An account has been created for you on <strong>{GYM_NAME}</strong> member portal.</p><p><strong>Email:</strong> {to_address}<br/><strong>Temporary password:</strong> {password}</p><p>Please sign in and change your password.</p><p>Thanks,<br/>{GYM_NAME}</p></body></html>"

    message.attach(MIMEText(plain, "plain"))
    message.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_address, message.as_string())
        log.info("Welcome email sent to %s", to_address)
        return True
    except Exception as exc:
        log.error("Welcome email failed for %s: %s", to_address, exc)
        return False


def fetch_all_members() -> list[dict[str, Any]]:
    if supabase:
        try:
            response = supabase.table("members").select("*").order("name").execute()
            return [serialize_member(member) for member in (response.data or [])]
        except Exception as exc:
            failover_to_sqlite("Supabase members query failed", exc)

    with sqlite_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM members
            ORDER BY name COLLATE NOCASE
            """
        ).fetchall()
    return [serialize_member(dict(row)) for row in rows]


def get_member_by_id(member_id: str) -> dict[str, Any] | None:
    if supabase:
        try:
            response = supabase.table("members").select("*").eq("id", member_id).limit(1).execute()
            items = response.data or []
            return serialize_member(items[0]) if items else None
        except Exception as exc:
            failover_to_sqlite("Supabase member lookup failed", exc)

    with sqlite_connection() as conn:
        row = conn.execute(
            "SELECT * FROM members WHERE id = ? LIMIT 1",
            (member_id,),
        ).fetchone()
    return serialize_member(dict(row)) if row else None


def get_member_by_email(member_email: str) -> dict[str, Any] | None:
    if supabase:
        try:
            response = (
                supabase.table("members")
                .select("*")
                .eq("email", member_email.lower())
                .limit(1)
                .execute()
            )
            items = response.data or []
            return serialize_member(items[0]) if items else None
        except Exception as exc:
            failover_to_sqlite("Supabase email lookup failed", exc)

    with sqlite_connection() as conn:
        row = conn.execute(
            "SELECT * FROM members WHERE lower(email) = lower(?) LIMIT 1",
            (member_email,),
        ).fetchone()
    return serialize_member(dict(row)) if row else None


def get_supabase_auth_admin():
    if not supabase_admin_client:
        return None
    admin = getattr(supabase_admin_client.auth, "admin", None)
    if not admin or not hasattr(admin, "create_user"):
        return None
    return admin


def link_member_auth_user_id(member_id: str, auth_user_id: str, storage_backend: str):
    if storage_backend == "supabase" and supabase:
        update_result = supabase.table("members").update({"auth_user_id": auth_user_id}).eq("id", member_id).execute()
        if getattr(update_result, "error", None):
            raise RuntimeError(getattr(update_result, "error", None))
        return

    with sqlite_connection() as conn:
        conn.execute(
            "UPDATE members SET auth_user_id = ?, updated_at = ? WHERE id = ?",
            (auth_user_id, utcnow_iso(), member_id),
        )


def create_member_auth_account(
    member: dict[str, Any], payload: dict[str, Any], storage_backend: str
) -> tuple[str | None, str, str]:
    admin = get_supabase_auth_admin()
    if not admin:
        return None, "not_configured", "Portal login was not created because the Supabase service-role key is missing or invalid."

    temp_password = build_initial_password(payload.get("name", ""))
    log.info("Generated initial password from member name for %s (length: %d)", payload.get("email"), len(temp_password))

    try:
        try:
            create_result = admin.create_user(
                {"email": payload["email"], "password": temp_password, "email_confirm": True}
            )
        except TypeError:
            create_result = admin.create_user(
                email=payload["email"], password=temp_password, email_confirm=True
            )

        created_user = None
        create_error = None
        if isinstance(create_result, dict):
            created_user = create_result.get("data") or create_result.get("user")
            create_error = create_result.get("error")
        else:
            created_user = getattr(create_result, "data", None) or getattr(create_result, "user", None)
            create_error = getattr(create_result, "error", None)

        if create_error:
            error_msg = create_error.get("message") if isinstance(create_error, dict) else str(create_error)
            raise RuntimeError(error_msg)

        auth_user_id = created_user.get("id") if isinstance(created_user, dict) else getattr(created_user, "id", None)
        if not auth_user_id:
            raise RuntimeError("Supabase auth user was created without returning an id.")

        log.info("Created Supabase Auth user %s for %s", auth_user_id, payload.get("email"))
        link_member_auth_user_id(member["id"], auth_user_id, storage_backend)
        member["auth_user_id"] = auth_user_id
        log.info("Linked auth_user_id %s to member %s", auth_user_id, member["id"])

        try:
            if smtp_is_configured():
                send_welcome_email(payload.get("email"), payload.get("name", ""), temp_password)
                log.info("Welcome email sent to %s", payload.get("email"))
            else:
                log.info(
                    "SMTP not configured - skipping welcome email for %s. Temp password: %s",
                    payload.get("email"),
                    temp_password,
                )
        except Exception as exc_email:
            log.warning("Failed to send welcome email to %s: %s", payload.get("email"), exc_email)

        return temp_password, "created", "Portal login created in Supabase Auth."
    except Exception as exc_auth:
        log.error("Supabase auth user creation exception for %s: %s", payload.get("email"), exc_auth)
        return None, "failed", "Portal login was not created in Supabase Auth. Check the backend logs and Supabase settings."


def create_member_record(payload: dict[str, Any]) -> tuple[dict[str, Any], str | None, str, str]:
    temp_password = None
    auth_status = "not_configured"
    auth_message = "Portal login was not created because Supabase Auth is unavailable."

    if supabase:
        try:
            response = supabase.table("members").insert(payload).select("*").single().execute()
            member = serialize_member(response.data)
            temp_password, auth_status, auth_message = create_member_auth_account(member, payload, "supabase")
            return member, temp_password, auth_status, auth_message
        except Exception as exc:
            failover_to_sqlite("Supabase member create failed", exc)

    now = utcnow_iso()
    member_id = str(uuid.uuid4())

    with sqlite_connection() as conn:
        conn.execute(
            """
            INSERT INTO members (
              id, name, email, auth_user_id, phone, plan, membership_type, due_date, join_date,
              notes, emergency_contact, health_notes, created_at, updated_at
            )
            VALUES (
              :id, :name, :email, :auth_user_id, :phone, :plan, :membership_type, :due_date, :join_date,
              :notes, :emergency_contact, :health_notes, :created_at, :updated_at
            )
            """,
            {
                "id": member_id,
                "name": payload["name"],
                "email": payload["email"],
                "auth_user_id": payload.get("auth_user_id"),
                "phone": payload.get("phone"),
                "plan": payload["plan"],
                "membership_type": payload.get("membership_type", "Strength Training"),
                "due_date": payload["due_date"],
                "join_date": payload.get("join_date", date.today().isoformat()),
                "notes": payload.get("notes"),
                "emergency_contact": payload.get("emergency_contact"),
                "health_notes": payload.get("health_notes"),
                "created_at": now,
                "updated_at": now,
            },
        )
    member = get_member_by_id(member_id)
    if not member:
        raise RuntimeError("Failed to create member.")
    temp_password, auth_status, auth_message = create_member_auth_account(member, payload, "sqlite")
    return member, temp_password, auth_status, auth_message


def update_member_record(member_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if supabase:
        try:
            response = (
                supabase.table("members")
                .update(payload)
                .eq("id", member_id)
                .select("*")
                .single()
                .execute()
            )
            return serialize_member(response.data)
        except Exception as exc:
            failover_to_sqlite("Supabase member update failed", exc)

    assignments = ", ".join(f"{field} = :{field}" for field in payload)
    values = dict(payload)
    values["id"] = member_id
    values["updated_at"] = utcnow_iso()

    with sqlite_connection() as conn:
        conn.execute(
            f"""
            UPDATE members
            SET {assignments}, updated_at = :updated_at
            WHERE id = :id
            """,
            values,
        )

    member = get_member_by_id(member_id)
    if not member:
        raise RuntimeError("Failed to update member.")
    return member


def delete_member_record(member_id: str):
    member = get_member_by_id(member_id)
    if member and member.get("auth_user_id"):
        admin = get_supabase_auth_admin()
        if admin and hasattr(admin, "delete_user"):
            try:
                delete_result = None
                try:
                    delete_result = admin.delete_user(member["auth_user_id"])
                except TypeError:
                    delete_result = admin.delete_user(user_id=member["auth_user_id"])

                if isinstance(delete_result, dict) and delete_result.get("error"):
                    log.warning("Failed to delete Supabase auth user for %s: %s", member.get("email"), delete_result.get("error"))
            except Exception as exc_auth_delete:
                log.warning("Supabase auth user deletion failed for %s: %s", member.get("email"), exc_auth_delete)

    if supabase:
        try:
            supabase.table("members").delete().eq("id", member_id).execute()
            return
        except Exception as exc:
            failover_to_sqlite("Supabase member delete failed", exc)

    with sqlite_connection() as conn:
        conn.execute("DELETE FROM members WHERE id = ?", (member_id,))


def get_notification_status(member_id: str, due_date_value: str) -> str | None:
    if supabase:
        try:
            response = (
                supabase.table("notifications")
                .select("id,status")
                .eq("member_id", member_id)
                .eq("due_date", due_date_value)
                .execute()
            )
            items = response.data or []
            return items[0].get("status") if items else None
        except Exception as exc:
            failover_to_sqlite("Supabase notification lookup failed", exc)

    with sqlite_connection() as conn:
        row = conn.execute(
            """
            SELECT status
            FROM notifications
            WHERE member_id = ? AND due_date = ?
            LIMIT 1
            """,
            (member_id, due_date_value),
        ).fetchone()
    return row["status"] if row else None


def record_notification(member: dict[str, Any], status: str = "pending"):
    if supabase:
        try:
            supabase.table("notifications").upsert(
                {
                    "member_id": member["id"],
                    "due_date": member["due_date"],
                    "status": status,
                    "sent_at": None,
                },
                on_conflict="member_id,due_date",
            ).execute()
            return
        except Exception as exc:
            failover_to_sqlite("Supabase notification upsert failed", exc)

    now = utcnow_iso()
    with sqlite_connection() as conn:
        conn.execute(
            """
            INSERT INTO notifications (
              id, member_id, member_name, member_email, due_date, status, sent_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(member_id, due_date) DO UPDATE SET
              member_name = excluded.member_name,
              member_email = excluded.member_email,
              status = excluded.status
            """,
            (
                str(uuid.uuid4()),
                member["id"],
                member.get("name"),
                member.get("email"),
                member["due_date"],
                status,
                None,
                now,
            ),
        )


def mark_notification(member_id: str, due_date_value: str, status: str):
    updates: dict[str, Any] = {"status": status}
    if status == "sent":
        updates["sent_at"] = utcnow_iso()

    if supabase:
        try:
            supabase.table("notifications").update(updates).eq("member_id", member_id).eq(
                "due_date", due_date_value
            ).execute()
            return
        except Exception as exc:
            failover_to_sqlite("Supabase notification update failed", exc)

    with sqlite_connection() as conn:
        conn.execute(
            """
            UPDATE notifications
            SET status = ?, sent_at = COALESCE(?, sent_at)
            WHERE member_id = ? AND due_date = ?
            """,
            (status, updates.get("sent_at"), member_id, due_date_value),
        )


def fetch_notifications(limit: int = 100) -> list[dict[str, Any]]:
    if supabase:
        try:
            response = (
                supabase.table("notifications")
                .select("*, members(name, email)")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return [serialize_notification(item) for item in (response.data or [])]
        except Exception as exc:
            failover_to_sqlite("Supabase notifications query failed", exc)

    with sqlite_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM notifications
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [serialize_notification(dict(row)) for row in rows]


def count_pending_notifications() -> int:
    if supabase:
        try:
            response = (
                supabase.table("notifications")
                .select("id")
                .eq("status", "pending")
                .execute()
            )
            return len(response.data or [])
        except Exception as exc:
            failover_to_sqlite("Supabase pending notification count failed", exc)

    with sqlite_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM notifications WHERE status = 'pending'"
        ).fetchone()
    return int(row["count"]) if row else 0


def get_members_due_in_days(days: int = 2) -> list[dict[str, Any]]:
    target = (date.today() + timedelta(days=days)).isoformat()

    if supabase:
        try:
            response = supabase.table("members").select("*").eq("due_date", target).execute()
            return [serialize_member(member) for member in (response.data or [])]
        except Exception as exc:
            failover_to_sqlite("Supabase due-date query failed", exc)

    with sqlite_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM members WHERE due_date = ? ORDER BY name COLLATE NOCASE",
            (target,),
        ).fetchall()
    return [serialize_member(dict(row)) for row in rows]


def get_members_needing_notifications(days_ahead: int = 2) -> list[dict[str, Any]]:
    today_value = date.today()
    target_value = today_value + timedelta(days=days_ahead)
    results: list[dict[str, Any]] = []

    for member in fetch_all_members():
        try:
            due_value = date.fromisoformat(member["due_date"])
        except Exception:
            continue

        if due_value <= target_value:
            item = dict(member)
            item["days_until_due"] = (due_value - today_value).days
            results.append(item)

    results.sort(key=lambda member: (member["days_until_due"], member.get("name") or ""))
    return results


def get_members_due_soon(days: int = 3) -> list[dict[str, Any]]:
    today_value = date.today()
    results: list[dict[str, Any]] = []

    for member in fetch_all_members():
        try:
            due_value = date.fromisoformat(member["due_date"])
        except Exception:
            continue

        offset = (due_value - today_value).days
        if -1 <= offset <= days:
            item = dict(member)
            item["days_until_due"] = offset
            results.append(item)

    results.sort(key=lambda member: member["days_until_due"])
    return results


def queue_due_notifications(days_ahead: int = 2) -> dict[str, int]:
    members = get_members_needing_notifications(days_ahead)
    created = skipped = 0

    for member in members:
        if get_notification_status(member["id"], member["due_date"]):
            skipped += 1
            continue
        record_notification(member, "pending")
        created += 1

    if created:
        add_activity(f"Queued {created} reminder notification(s)", "notif")
    return {"created": created, "skipped": skipped, "total_due": len(members)}


def run_notification_job(days_ahead: int = 2) -> dict[str, int]:
    log.info("Running notification job for overdue members and those due within %s day(s).", days_ahead)
    members = get_members_needing_notifications(days_ahead)
    sent = skipped = failed = 0

    for member in members:
        member_id = member["id"]
        due_date_value = member["due_date"]
        current_status = get_notification_status(member_id, due_date_value)

        if current_status == "sent":
            skipped += 1
            continue

        record_notification(member, "pending")

        if send_email(member["email"], member["name"], due_date_value, member.get("plan", "Monthly")):
            mark_notification(member_id, due_date_value, "sent")
            sent += 1
        else:
            mark_notification(member_id, due_date_value, "failed")
            failed += 1

    if sent or failed:
        add_activity(
            f"Notification run complete: {sent} sent, {failed} failed, {skipped} already handled",
            "notif",
        )
    summary = {"sent": sent, "skipped": skipped, "failed": failed, "total_due": len(members)}
    log.info("Notification job complete: %s", summary)
    return summary


def renew_member(member_id: str, plan: str) -> dict[str, Any]:
    valid_plans = {"Monthly": 30, "Quarterly": 90, "Annual": 365}
    if plan not in valid_plans:
        raise ValueError("plan must be Monthly, Quarterly, or Annual.")

    existing = get_member_by_id(member_id)
    if not existing:
        raise ValueError("Member not found.")

    today_value = date.today()
    current_due = date.fromisoformat(existing["due_date"])
    renewal_base = current_due if current_due > today_value else today_value
    next_due = (renewal_base + timedelta(days=valid_plans[plan])).isoformat()

    updated = update_member_record(
        member_id,
        {
            "plan": plan,
            "due_date": next_due,
        },
    )
    add_activity(f"Membership renewed: {updated['name']} ({plan})", "edit")
    return updated


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "ok": True,
            "status": "ok",
            "gym": GYM_NAME,
            "date": date.today().isoformat(),
            "database_mode": DATABASE_MODE,
            "supabase_configured": bool(supabase),
            "supabase_auth_configured": bool(get_supabase_auth_admin()),
            "sqlite_path": str(SQLITE_PATH),
        }
    )


@app.route("/", methods=["GET"])
def about():
    return send_from_directory(FRONTEND_DIR, "about.html")


@app.route("/user", methods=["GET"])
def serve_user_portal():
    return send_from_directory(FRONTEND_DIR, "user.html")


@app.route("/index", methods=["GET"])
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    return ("", 204)


@app.route("/<path:filename>", methods=["GET"])
def serve_frontend_asset(filename: str):
    if filename.startswith("api/") or filename == "health":
        return error_response("Not found.", 404)
    file_path = FRONTEND_DIR / filename
    if file_path.exists() and file_path.is_file():
        return send_from_directory(FRONTEND_DIR, filename)
    return error_response("Not found.", 404)


@app.route("/api/members", methods=["GET"])
def api_get_members():
    missing = require_database()
    if missing:
        return missing
    return jsonify({"ok": True, "members": fetch_all_members()})


@app.route("/api/members", methods=["POST"])
def api_create_member():
    missing = require_database()
    if missing:
        return missing

    try:
        payload = safe_member_payload(request.get_json(silent=True) or {}, partial=False)
        if "join_date" not in payload or not payload["join_date"]:
            payload["join_date"] = date.today().isoformat()
    except ValueError as exc:
        return error_response(str(exc), 400)

    try:
        member, temp_password, auth_status, auth_message = create_member_record(payload)
        add_activity(f"Member added: {member['name']}", "add")
        response_body = {
            "ok": True,
            "member": member,
            "auth_status": auth_status,
            "auth_message": auth_message,
        }
        if temp_password:
            response_body["temporary_password"] = temp_password
        return jsonify(response_body), 201
    except Exception as exc:
        log.warning("Member create failed for email %s: %s", payload.get("email"), exc)
        return error_response(humanize_database_error(exc), 400)


@app.route("/api/members/<member_id>", methods=["GET"])
def api_get_member(member_id: str):
    missing = require_database()
    if missing:
        return missing
    if not is_uuid(member_id):
        return error_response("Invalid member id.", 400)
    member = get_member_by_id(member_id)
    if not member:
        return error_response("Member not found.", 404)
    return jsonify({"ok": True, "member": member})


@app.route("/api/members/by-email", methods=["GET"])
def api_get_member_by_email():
    missing = require_database()
    if missing:
        return missing

    raw_email = (request.args.get("email") or "").strip()
    if not raw_email:
        return error_response("email is required.", 400)

    member = get_member_by_email(unquote(raw_email))
    if not member:
        return error_response("Member not found.", 404)
    return jsonify({"ok": True, "member": member})


@app.route("/api/members/<member_id>", methods=["PUT", "PATCH"])
def api_update_member(member_id: str):
    missing = require_database()
    if missing:
        return missing
    if not is_uuid(member_id):
        return error_response(
            "Invalid member id. Open the member list again and choose a saved database member.",
            400,
        )

    existing = get_member_by_id(member_id)
    if not existing:
        return error_response("Member not found.", 404)

    try:
        payload = safe_member_payload(request.get_json(silent=True) or {}, partial=True)
    except ValueError as exc:
        return error_response(str(exc), 400)

    if not payload:
        return error_response("No member fields provided.", 400)

    try:
        member = update_member_record(member_id, payload)
        add_activity(f"Member updated: {member['name']}", "edit")
        return jsonify({"ok": True, "member": member})
    except Exception as exc:
        log.warning("Member update failed for %s: %s", member_id, exc)
        return error_response(humanize_database_error(exc), 400)


@app.route("/api/members/<member_id>", methods=["DELETE"])
def api_delete_member(member_id: str):
    missing = require_database()
    if missing:
        return missing
    if not is_uuid(member_id):
        return error_response("Invalid member id.", 400)

    existing = get_member_by_id(member_id)
    if not existing:
        return error_response("Member not found.", 404)

    try:
        delete_member_record(member_id)
        add_activity(f"Member deleted: {existing['name']}", "delete")
        return jsonify({"ok": True})
    except Exception as exc:
        log.warning("Member delete failed for %s: %s", member_id, exc)
        return error_response(humanize_database_error(exc), 400)


@app.route("/api/members/<member_id>/renew", methods=["POST"])
def api_renew_member(member_id: str):
    missing = require_database()
    if missing:
        return missing
    if not is_uuid(member_id):
        return error_response("Invalid member id.", 400)

    payload = request.get_json(silent=True) or {}
    plan = str(payload.get("plan") or "").strip()
    if not plan:
        return error_response("plan is required.", 400)

    try:
        member = renew_member(member_id, plan)
        return jsonify({"ok": True, "member": member})
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        return error_response(str(exc), status)
    except Exception as exc:
        return error_response(str(exc), 400)


@app.route("/api/activity", methods=["GET"])
def api_activity():
    missing = require_database()
    if missing:
        return missing

    try:
        limit = max(1, min(int(request.args.get("limit", "30")), 100))
    except ValueError:
        return error_response("limit must be a number.", 400)
    return jsonify({"ok": True, "activity": fetch_activity(limit)})


@app.route("/api/stats", methods=["GET"])
def api_stats():
    missing = require_database()
    if missing:
        return missing

    members = fetch_all_members()
    today_value = date.today().isoformat()
    in_two_days = (date.today() + timedelta(days=2)).isoformat()

    total = len(members)
    overdue = sum(1 for member in members if member["due_date"] < today_value)
    expiring = sum(1 for member in members if today_value <= member["due_date"] <= in_two_days)
    active = total - overdue - expiring
    pending = count_pending_notifications()

    return jsonify(
        {
            "ok": True,
            "stats": {
                "total": total,
                "overdue": overdue,
                "expiring_soon": expiring,
                "active": active,
                "pending_notifs": pending,
            },
        }
    )


@app.route("/api/members/due-soon", methods=["GET"])
def api_members_due_soon():
    missing = require_database()
    if missing:
        return missing

    try:
        days = max(0, min(int(request.args.get("days", "3")), 30))
    except ValueError:
        return error_response("days must be a number.", 400)

    results = get_members_due_soon(days)
    return jsonify({"ok": True, "members": results, "count": len(results)})


@app.route("/api/notifications", methods=["GET"])
def api_get_notifications():
    missing = require_database()
    if missing:
        return missing
    return jsonify({"ok": True, "notifications": fetch_notifications(100)})


@app.route("/api/notifications/queue", methods=["POST"])
def api_queue_notifications():
    missing = require_database()
    if missing:
        return missing

    payload = request.get_json(silent=True) or {}
    try:
        days_ahead = int(payload.get("days_ahead", 2))
    except ValueError:
        return error_response("days_ahead must be a number.", 400)

    summary = queue_due_notifications(days_ahead)
    return jsonify({"ok": True, "summary": summary})


@app.route("/api/notify/run", methods=["POST"])
def api_run_notifications():
    missing = require_database()
    if missing:
        return missing

    payload = request.get_json(silent=True) or {}
    try:
        days_ahead = int(payload.get("days_ahead", 2))
    except ValueError:
        return error_response("days_ahead must be a number.", 400)

    summary = run_notification_job(days_ahead)
    return jsonify({"ok": True, "summary": summary})


@app.route("/api/create-order", methods=["POST"])
def api_create_order():
    if not razorpay_client:
        return error_response("Razorpay is not configured.", 503)

    payload = request.get_json(silent=True) or {}
    amount = payload.get("amount")
    currency = payload.get("currency", "INR")
    receipt = payload.get("receipt", f"receipt_{int(datetime.now().timestamp())}")
    description = payload.get("description", "Membership")

    if not amount or not isinstance(amount, (int, float)):
        return error_response("amount is required and must be a number.", 400)
    if amount < 100:
        return error_response("Minimum amount is 100 paise (Rs 1).", 400)

    try:
        order = razorpay_client.order.create(
            data={
                "amount": int(amount),
                "currency": currency,
                "receipt": receipt,
                "notes": {"description": description},
            }
        )
        log.info("Razorpay order created: %s", order["id"])
        return jsonify(
            {
                "ok": True,
                "key_id": RAZORPAY_KEY_ID,
                "order_id": order["id"],
                "amount": order["amount"],
                "currency": order["currency"],
            }
        )
    except Exception as exc:
        log.error("Failed to create Razorpay order: %s", exc)
        return error_response(f"Failed to create order: {exc}", 500)


@app.route("/api/verify-payment", methods=["POST"])
def api_verify_payment():
    if not razorpay_client:
        return error_response("Razorpay is not configured.", 503)

    payload = request.get_json(silent=True) or {}
    order_id = payload.get("razorpay_order_id")
    payment_id = payload.get("razorpay_payment_id")
    signature = payload.get("razorpay_signature")

    if not all([order_id, payment_id, signature]):
        return error_response(
            "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature.",
            400,
        )

    try:
        data = f"{order_id}|{payment_id}"
        generated_signature = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            data.encode(),
            hashlib.sha256,
        ).hexdigest()

        if generated_signature != signature:
            log.warning("Payment signature mismatch for order %s", order_id)
            return error_response("Payment verification failed. Signature mismatch.", 400)

        log.info("Payment verified successfully: %s for order %s", payment_id, order_id)
        return jsonify(
            {
                "ok": True,
                "message": "Payment verified successfully",
                "payment_id": payment_id,
                "order_id": order_id,
            }
        )
    except Exception as exc:
        log.error("Payment verification error: %s", exc)
        return error_response(f"Verification failed: {exc}", 500)


def start_scheduler():
    schedule.every().day.at("09:00").do(run_notification_job)
    log.info("Scheduler started. Notification job will run daily at 09:00.")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    thread = threading.Thread(target=start_scheduler, daemon=True)
    thread.start()
    log.info("Starting Forge Fitness backend on http://0.0.0.0:%s", PORT)
    app.run(host="0.0.0.0", port=PORT, debug=False)
