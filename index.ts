/* ==========================================================================
 *  OASIS BIAM LABORATORY SCHOOL — ULTIMATE ENTERPRISE SERVER
 *  ==========================================================================
 *  File: index.ts
 *  Architecture: Express + Better Auth + MongoDB + Vercel Serverless
 *  ==========================================================================
 */

/* ==========================================================================
 * SECTION 1: IMPORTS
 * ========================================================================== */

import "dotenv/config";
import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { MongoClient, ObjectId, Db, Collection, Document, Filter } from "mongodb";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

/* ==========================================================================
 * SECTION 2: ENVIRONMENT CONFIGURATION
 * ========================================================================== */

const PORT = Number(process.env.PORT || 5000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
const BETTER_AUTH_URL = (process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;

const IMGBB_API_KEY = process.env.IMGBB_API_KEY?.trim();
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
const EMAIL_FROM = process.env.EMAIL_FROM?.trim();

const ADMIN_NAME = process.env.ADMIN_NAME || "Oasis BIAM Administrator";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET?.trim();

const AUTH_COOKIE_SAME_SITE = (
  process.env.AUTH_COOKIE_SAME_SITE || (IS_PRODUCTION ? "lax" : "lax")
) as "lax" | "strict" | "none";

const LOGO_URL = "https://i.ibb.co.com/7NzsPGvc/logo.jpg";
const HERO_SLIDES = [
  "https://i.ibb.co.com/j9p9vNfJ/images-1.jpg",
  "https://i.ibb.co.com/67z0dmbS/images.jpg",
];
const API_VERSION = "5.1.5";

/* ==========================================================================
 * SECTION 3: FATAL ENVIRONMENT VALIDATION
 * ========================================================================== */

if (!MONGODB_URI) throw new Error("FATAL: MONGODB_URI is missing.");
if (!DB_NAME) throw new Error("FATAL: DB_NAME is missing.");
if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
  throw new Error("FATAL: BETTER_AUTH_SECRET must be at least 32 characters.");
}

/* ==========================================================================
 * SECTION 4: TYPE DEFINITIONS
 * ========================================================================== */

interface BaseDoc extends Document {
  _id: ObjectId;
  createdAt: Date;
  updatedAt?: Date;
}

interface UserDoc extends BaseDoc {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  role: "admin" | "member";
  phone?: string;
  address?: string;
}

interface NoticeDoc extends BaseDoc {
  title: string;
  content: string;
  category: string;
  featured: boolean;
  authorId: string;
  authorName: string;
}

interface ArticleDoc extends BaseDoc {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  category: string;
  authorId: string;
  authorName: string;
  views: number;
  published: boolean;
}

interface TeacherDoc extends BaseDoc {
  name: string;
  role: "principal" | "vice-principal" | "teacher";
  designation: string;
  subject: string;
  image: string | null;
  bio: string;
  email: string;
  phone: string;
  qualification: string;
  experience: string;
  order: number;
}

interface GoverningBodyDoc extends BaseDoc {
  name: string;
  position: string;
  image: string | null;
  isChairman: boolean;
  order: number;
  message?: string;
}

interface ContactDoc extends BaseDoc {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  status: "new" | "read" | "replied" | "archived";
}

interface AdmissionDoc extends BaseDoc {
  studentName: string;
  fatherName: string;
  motherName: string;
  birthDate: string;
  bloodGroup: string;
  classApplyingFor: string;
  previousClass: string;
  phone: string;
  email: string;
  currentAddress: string;
  permanentAddress: string;
  birthCertificateImage?: string;
  previousSchoolCertificateImage?: string;
  passportPhotosImage?: string;
  parentNidImage?: string;
  status: "pending" | "approved" | "rejected";
}

interface NotificationDoc extends BaseDoc {
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  read: boolean;
  readAt?: Date;
}

interface SettingsDoc extends BaseDoc {
  _id: any;
  siteName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  facebook: string;
  youtube: string;
  twitter: string;
  instagram: string;
}

interface GalleryDoc extends BaseDoc {
  title: string;
  image: string;
  caption: string;
  category: string;
}

interface EventDoc extends BaseDoc {
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  image: string | null;
  category: string;
}

interface AchievementDoc extends BaseDoc {
  title: string;
  description: string;
  year: string;
  image: string | null;
  category: string;
}

interface ActivityDoc extends BaseDoc {
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, any>;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
}

/* ==========================================================================
 * SECTION 5: LAZY DATABASE CONNECTION (Vercel Fix)
 * ========================================================================== */

let mongoClient: MongoClient | null = null;
let database: Db | null = null;
let connectionPromise: Promise<Db> | null = null;

async function getDB(): Promise<Db> {
  if (database) return database;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    const client = new MongoClient(MONGODB_URI!, {
      maxPoolSize: IS_VERCEL ? 1 : 25,
      minPoolSize: IS_VERCEL ? 0 : 5,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });

    await client.connect();
    mongoClient = client;
    database = client.db(DB_NAME);
    console.log(`✅ MongoDB connected → ${DB_NAME}`);
    return database;
  })();

  try {
    return await connectionPromise;
  } catch (err) {
    connectionPromise = null;
    console.error("❌ MongoDB connection failed:", (err as Error).message);
    throw err;
  }
}

/* ==========================================================================
 * SECTION 6: LAZY COLLECTION ACCESSORS
 * ========================================================================== */

const usersCol = () => getDB().then((d) => d.collection<UserDoc>("user"));
const noticesCol = () => getDB().then((d) => d.collection<NoticeDoc>("notices"));
const articlesCol = () => getDB().then((d) => d.collection<ArticleDoc>("articles"));
const teachersCol = () => getDB().then((d) => d.collection<TeacherDoc>("teachers"));
const governingCol = () => getDB().then((d) => d.collection<GoverningBodyDoc>("governingBody"));
const contactsCol = () => getDB().then((d) => d.collection<ContactDoc>("contacts"));
const admissionsCol = () => getDB().then((d) => d.collection<AdmissionDoc>("admissions"));
const notificationsCol = () => getDB().then((d) => d.collection<NotificationDoc>("notifications"));
const settingsCol = () => getDB().then((d) => d.collection<SettingsDoc>("settings"));
const galleryCol = () => getDB().then((d) => d.collection<GalleryDoc>("gallery"));
const eventsCol = () => getDB().then((d) => d.collection<EventDoc>("events"));
const achievementsCol = () => getDB().then((d) => d.collection<AchievementDoc>("achievements"));
const activityCol = () => getDB().then((d) => d.collection<ActivityDoc>("activityLog"));

/* ==========================================================================
 * SECTION 7: ERROR ARCHITECTURE
 * ========================================================================== */

class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler => {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};

/* ==========================================================================
 * SECTION 8: RESPONSE HELPERS & UTILITIES
 * ========================================================================== */

const ok = (res: Response, data: any, status = 200) =>
  res.status(status).json({ success: true, data });

const msg = (res: Response, message: string, status = 200) =>
  res.status(status).json({ success: true, message });

const fail = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, message });

const paginated = (res: Response, items: any[], page: number, limit: number, total: number) =>
  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    },
  });

const parseId = (id: string): ObjectId => {
  try { return new ObjectId(id); } 
  catch { throw new AppError("Invalid ID format. Must be 24-char hex.", 400); }
};

const validateRequired = (body: any, fields: string[]): void => {
  if (!body) throw new AppError("Request body is empty", 400);
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || (typeof v === "string" && !v.trim());
  });
  if (missing.length > 0) throw new AppError(`Missing required fields: ${missing.join(", ")}`, 400);
};

const cleanString = (value: any, fallback: string = ""): string => {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
};

const sanitizeInput = (input: string): string => {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "");
};

const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return entities[char] || char;
  });
};

const slugify = (text: string): string => {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);
};

const truncate = (text: string, maxLen: number = 150): string =>
  text.length > maxLen ? text.substring(0, maxLen) + "..." : text;

const getPagination = (pageStr?: string, limitStr?: string) => {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitStr || "20", 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const generateRequestId = (): string => Math.random().toString(36).substring(2, 10);

/* ==========================================================================
 * SECTION 9: ACTIVITY LOGGING & NOTIFICATIONS
 * ========================================================================== */

async function logActivity(req: Request, action: string, entity: string, entityId?: string, details?: any): Promise<void> {
  try {
    const col = await activityCol();
    await col.insertOne({
      action, entity, entityId: entityId || null, details: details || {},
      actorId: req.user?.id || null, actorName: req.user?.name || "System",
      actorEmail: req.user?.email || null, ip: req.ip || null,
      userAgent: req.headers["user-agent"] || null, createdAt: new Date(),
    });
  } catch (e) { console.error("⚠️ Activity log failed:", (e as Error).message); }
}

async function createNotification(title: string, message: string, type: "info" | "success" | "warning" | "error" = "info"): Promise<void> {
  try {
    const col = await notificationsCol();
    await col.insertOne({ title, message, type, read: false, createdAt: new Date() });
  } catch (e) { console.error("⚠️ Notification failed:", (e as Error).message); }
}

/* ==========================================================================
 * SECTION 10: BETTER AUTH & EMAIL
 * ========================================================================== */

async function sendVerificationEmail(user: { name?: string | null; email: string }, url: string): Promise<void> {
  const safeName = escapeHtml(user.name || "there");
  const safeUrl = escapeHtml(url);

  if (RESEND_API_KEY && EMAIL_FROM) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM, to: [user.email], subject: "Verify your Oasis BIAM account",
          html: `<div style="font-family:sans-serif;padding:20px"><h2>Verify your email</h2><p>Hello ${safeName},</p><p><a href="${safeUrl}" style="padding:12px 20px;background:#10b981;color:white;text-decoration:none;border-radius:6px">Verify Email</a></p></div>`,
        }),
      });
    } catch (e) { console.error("Email send error:", e); }
  } else if (!IS_PRODUCTION) {
    console.warn("⚠️ Dev verify URL:\n", url);
  }
}

/* ==========================================================================
 * SECTION 11: LAZY BETTER AUTH FACTORY & ADMIN SEEDER
 * ========================================================================== */

type AuthInstance = ReturnType<typeof betterAuth>;
let authInstance: AuthInstance | null = null;
let authPromise: Promise<AuthInstance> | null = null;

// 🔧 SAFE: Only creates the initial admin if missing. NEVER deletes anything.
async function ensureAdminAccount(auth: AuthInstance) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.log("ℹ️ ADMIN_EMAIL or ADMIN_PASSWORD not set. Skipping admin seed.");
    return;
  }

  try {
    const db = await getDB();
    const existingUser = await db.collection("user").findOne({ email: ADMIN_EMAIL });

    if (!existingUser) {
      console.log(`⏳ Admin account not found. Creating for ${ADMIN_EMAIL}...`);
      await auth.api.signUpEmail({
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME }
      });
      console.log(`✅ Admin account created successfully with email/password.`);
    } else {
      console.log(`✅ Admin account already exists. Skipping creation.`);
    }
  } catch (err: any) {
    console.error("❌ Failed to ensure admin account:", err.message);
  }
}

function getAuth(): Promise<AuthInstance> {
  if (authInstance) return Promise.resolve(authInstance);

  if (!authPromise) {
    authPromise = getDB()
      .then((db) => {
        const instance = betterAuth({
          secret: BETTER_AUTH_SECRET!,
          baseURL: BETTER_AUTH_URL, 
          database: mongodbAdapter(db),
          
          trustedOrigins: [
            CLIENT_URL,
            "https://oasis-biam-laboratory-school.vercel.app",
            "http://localhost:3000",
            "http://127.0.0.1:3000"
          ],

          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false,
            minPasswordLength: 8,
            autoSignIn: true,
          },
          emailVerification: {
            sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true, expiresIn: 3600,
            sendVerificationEmail: async ({ user, url }) => await sendVerificationEmail(user, url),
          },
          ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
            socialProviders: {
              google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                prompt: "select_account" as const,
              },
            },
          } : {}),
          account: { 
            storeStateStrategy: "database",
            accountLinking: { enabled: true, trustedProviders: ["google"] } 
          },

          logger: { disabled: false },
          user: {
            additionalFields: {
              role: { type: "string", defaultValue: "member", input: false },
              phone: { type: "string", required: false, defaultValue: "", input: true },
              address: { type: "string", required: false, defaultValue: "", input: true },
            },
          },
          session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
          advanced: {
            defaultCookieAttributes: {
              sameSite: "lax",
              secure: IS_PRODUCTION,
              httpOnly: true,
              path: "/",
            },
          },
          databaseHooks: {
            user: {
              create: {
                after: async (user: any) => {
                  try {
                    const db = await getDB();
                    const isAdminEmail = ADMIN_EMAIL && user.email === ADMIN_EMAIL;
                    
                    await db.collection("user").updateOne(
                      { email: user.email }, 
                      { $set: { 
                          role: isAdminEmail ? "admin" : "member", 
                          emailVerified: true 
                      } }
                    );
                    
                    if (isAdminEmail) console.log(`👑 Auto-promoted and verified admin: ${user.email}`);
                    else console.log(`✅ Auto-verified new user: ${user.email}`);
                  } catch (e) { 
                    console.error("Auto-verify failed:", e); 
                  }
                },
              },
            },
          },
        });

        authInstance = instance;
        console.log("✅ Better Auth instance created");
        
        ensureAdminAccount(instance).catch(console.error);

        return instance;
      })
      .catch((err) => {
        authPromise = null;
        console.error("❌ Better Auth creation failed:", err.message);
        throw err;
      });
  }

  return authPromise;
}

/* ==========================================================================
 * SECTION 12: EXPRESS APP & GLOBAL MIDDLEWARE
 * ========================================================================== */

const app = express();

if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));

const allowedOrigins = new Set([
  CLIENT_URL, 
  "https://oasis-biam-laboratory-school.vercel.app",
  "http://localhost:3000", 
  "http://127.0.0.1:3000"
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    console.warn(`[CORS Blocked] Origin: ${origin}`);
    return cb(new AppError(`Blocked by CORS: ${origin}`, 403));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
}));

app.use(morgan(IS_PRODUCTION ? "combined" : "dev"));

app.use((req, res, next) => {
  (req as any).requestId = generateRequestId();
  res.setHeader("X-Request-ID", (req as any).requestId);
  res.setHeader("X-API-Version", API_VERSION);
  next();
});

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
}));

app.all("/api/auth/*", (req, res, next) => {
  getAuth().then((auth) => toNodeHandler(auth)(req, res, next)).catch(next);
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* ==========================================================================
 * SECTION 13: FILE UPLOAD
 * ========================================================================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(null, true);
    cb(new AppError("Unsupported image type. Use JPG, PNG, or WebP.", 415));
  },
});

/* ==========================================================================
 * SECTION 14: SESSION MIDDLEWARE & AUTH GUARDS
 * ========================================================================== */

declare global {
  namespace Express {
    interface Request { user?: any; session?: any; requestId?: string; }
  }
}

app.use("/api", catchAsync(async (req, _res, next) => {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session) { req.user = session.user; req.session = session.session; }
  } catch (e) {
    if (!IS_PRODUCTION) console.warn("⚠️ Session lookup failed:", (e as Error).message);
  }
  next();
}));

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError("Authentication required. Please log in.", 401));
  next();
};

const requireAdmin = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError("Authentication required.", 401));
  const col = await usersCol();
  const dbUser = await col.findOne({ email: req.user.email });
  if (!dbUser || dbUser.role !== "admin") return next(new AppError("Admin access required.", 403));
  req.user.role = "admin";
  next();
});

/* ==========================================================================
 * SECTION 15: PREMIUM CSS
 * ========================================================================== */

const PREMIUM_CSS = `
:root{--bg-base:#fafaf9;--bg-soft:#fef2f2;--panel:rgba(255,255,255,0.7);--panel-hover:rgba(255,255,255,0.9);--border:rgba(0,0,0,0.08);--border-strong:rgba(0,0,0,0.15);--text-main:#1c1917;--text-muted:#78716c;--accent:#dc2626;--accent-glow:rgba(220,38,38,0.3);--highlight:#f59e0b;--btn-text:#fff;--success:#059669;--danger:#dc2626;--font:'Inter',-apple-system,sans-serif;--mono:'SF Mono',monospace}
.dark{--bg-base:#022c22;--bg-soft:#064e3b;--panel:rgba(255,255,255,0.03);--panel-hover:rgba(255,255,255,0.06);--border:rgba(255,255,255,0.08);--border-strong:rgba(255,255,255,0.15);--text-main:#ecfdf5;--text-muted:#6ee7b7;--accent:#10b981;--accent-glow:rgba(16,185,129,0.4);--highlight:#06b6d4;--btn-text:#000;--success:#10b981;--danger:#ef4444}
*{box-sizing:border-box;margin:0;padding:0;font-family:var(--font);transition:background-color .3s,border-color .3s,color .3s}
body{background:var(--bg-base);background-image:radial-gradient(circle at top left,var(--bg-soft),var(--bg-base) 70%);color:var(--text-main);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;line-height:1.6;-webkit-font-smoothing:antialiased}
.blob{position:absolute;border-radius:50%;filter:blur(100px);z-index:-1;opacity:.2;pointer-events:none;animation:float 12s infinite ease-in-out alternate}
.blob-1{background:var(--accent);width:600px;height:600px;top:-200px;left:-200px}
.blob-2{background:var(--highlight);width:500px;height:500px;bottom:-150px;right:-150px;animation-delay:-6s}
.container{max-width:1100px;width:100%;background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:4rem;backdrop-filter:blur(20px);box-shadow:0 25px 50px -12px rgba(0,0,0,.25),0 0 60px var(--accent-glow);position:relative;overflow:hidden}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:3rem;gap:1.5rem;flex-wrap:wrap}
.header-left{display:flex;align-items:center;gap:1.5rem;min-width:0}
.logo{width:80px;height:80px;border-radius:20px;border:2px solid var(--border);box-shadow:0 0 20px var(--accent-glow);object-fit:cover}
.header-text h1{font-size:2rem;font-weight:800;letter-spacing:-.5px}
.header-text p{font-size:.85rem;color:var(--text-muted);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-top:.25rem}
.theme-toggle{background:var(--panel);border:1px solid var(--border);color:var(--text-main);padding:12px 20px;border-radius:12px;cursor:pointer;font-weight:700;font-size:.9rem}
.theme-toggle:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 10px 20px var(--accent-glow)}
.status-pill{display:inline-flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--border);padding:10px 24px;border-radius:30px;font-size:.85rem;font-weight:800;color:var(--accent);margin-bottom:2rem}
.dot{width:12px;height:12px;background:var(--accent);border-radius:50%;box-shadow:0 0 15px var(--accent);animation:pulse 2s infinite}
.dot.danger{background:var(--danger)}
.dot.success{background:var(--success)}
.hero-title{font-size:4rem;font-weight:800;line-height:1.1;margin-bottom:1.5rem;letter-spacing:-2px}
.highlight{background:linear-gradient(90deg,var(--accent),var(--highlight));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero-desc{font-size:1.15rem;color:var(--text-muted);line-height:1.6;margin-bottom:3rem;max-width:700px;font-weight:500}
.section-title{font-size:1.5rem;font-weight:800;margin:3rem 0 1.5rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1.5rem;margin-bottom:2rem}
.card{background:var(--panel);border:1px solid var(--border);padding:2rem;border-radius:20px;position:relative;overflow:hidden;transition:all .3s}
.card:hover{transform:translateY(-5px);border-color:var(--accent);box-shadow:0 20px 40px -10px var(--accent-glow)}
.card-label{font-size:.8rem;color:var(--text-muted);font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px}
.card-val{font-size:1.6rem;font-weight:800;display:flex;align-items:center;gap:8px}
.btn{text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:700;font-size:1rem;display:inline-flex;align-items:center;gap:10px;border:none;cursor:pointer;transition:all .3s}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--highlight));color:var(--btn-text);box-shadow:0 10px 20px var(--accent-glow)}
.btn-primary:hover{transform:translateY(-3px);filter:brightness(1.1)}
.btn-outline{background:transparent;border:2px solid var(--border-strong);color:var(--text-main)}
.btn-outline:hover{border-color:var(--accent);background:var(--panel)}
.actions{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem}
.list{display:flex;flex-direction:column;gap:.75rem;margin:1.5rem 0}
.list-item{display:flex;align-items:center;gap:1rem;padding:1rem;background:var(--panel);border:1px solid var(--border);border-radius:12px;transition:all .3s}
.list-item:hover{border-color:var(--accent);transform:translateX(4px)}
.list-content{flex:1}
.list-title{font-weight:700;margin-bottom:.25rem}
.list-desc{font-size:.85rem;color:var(--text-muted)}
.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:.7rem;font-weight:700;text-transform:uppercase;font-family:var(--mono)}
.badge-get{background:rgba(16,185,129,.15);color:var(--success)}
.badge-post{background:rgba(2,132,199,.15);color:#0284c7}
.badge-put{background:rgba(217,119,6,.15);color:#d97706}
.badge-del{background:rgba(220,38,38,.15);color:var(--danger)}
.footer{margin-top:4rem;padding-top:2rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;color:var(--text-muted);font-size:.95rem;font-weight:600;flex-wrap:wrap;gap:1rem}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}
@keyframes float{0%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-40px) scale(1.05)}100%{transform:translate(0,0) scale(1)}}
@media(max-width:768px){body{padding:1rem}.container{padding:2rem;border-radius:16px}.header{flex-direction:column;align-items:flex-start}.hero-title{font-size:2rem;letter-spacing:-1px}.footer{flex-direction:column;text-align:center}.btn{width:100%;justify-content:center}.grid{grid-template-columns:1fr}}
`;

/* ==========================================================================
 * SECTION 16: PREMIUM HTML ROUTES
 * ========================================================================== */

app.get("/", (_req, res) => {
  const uptime = Math.floor(process.uptime());
  const time = new Date().toLocaleTimeString();

  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${LOGO_URL}"><title>Oasis BIAM | Enterprise Server</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${PREMIUM_CSS}</style></head><body><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="container"><div class="header"><div class="header-left"><img src="${LOGO_URL}" class="logo"><div class="header-text"><h1>Oasis BIAM</h1><p>Enterprise Server v${API_VERSION}</p></div></div><button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark');document.body.classList.toggle('dark')">🌓 Toggle Theme</button></div><div class="status-pill"><div class="dot"></div> All Systems Operational</div><h2 class="hero-title">Hi <span class="highlight">${escapeHtml(ADMIN_NAME)}</span>,<br>your server is flying.</h2><p class="hero-desc">The Oasis BIAM Enterprise API is securely answering requests. Everything you need to manage the website is live and ready for action.</p><div class="grid"><div class="card"><div class="card-label">Server Uptime</div><div class="card-val" style="color:var(--accent)">${uptime}s</div></div><div class="card"><div class="card-label">Environment</div><div class="card-val">${escapeHtml(process.env.NODE_ENV || "development")}</div></div><div class="card"><div class="card-label">Platform</div><div class="card-val">${IS_VERCEL ? "Vercel" : "Node.js"}</div></div><div class="card"><div class="card-label">API Version</div><div class="card-val">${API_VERSION}</div></div></div><div class="actions"><a href="/api/health" class="btn btn-primary">Health Check →</a><a href="/api/home" class="btn btn-outline">API Index</a><a href="/api/docs" class="btn btn-outline">API Docs</a><a href="${escapeHtml(CLIENT_URL)}/dashboard/admin" class="btn btn-outline">Admin Dashboard</a></div><div class="footer"><span>© ${new Date().getFullYear()} Oasis BIAM Laboratory School</span><span>Local Time: ${time}</span></div></div></body></html>`);
});

app.get("/api/health", catchAsync(async (req, res) => {
  let dbOk = false;
  let dbError = "";

  try {
    const d = await getDB();
    await d.command({ ping: 1 });
    dbOk = true;
  } catch (e: any) {
    dbError = e.message || "Connection failed";
    console.error("Health check DB error:", dbError);
  }

  const health = {
    status: dbOk ? "ok" : "error",
    db: dbOk ? "connected" : "unreachable",
    ...(IS_PRODUCTION ? {} : { dbError: dbOk ? undefined : dbError }),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
    platform: IS_VERCEL ? "vercel" : "node",
    version: API_VERSION,
  };

  if (req.headers.accept?.includes("text/html")) {
    const memoryUsed = Math.round(health.memory.heapUsed / 1024 / 1024);
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Health | Oasis BIAM</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${PREMIUM_CSS}</style></head><body><div class="blob blob-1"></div><div class="container"><div class="header"><div class="header-left"><img src="${LOGO_URL}" class="logo"><div class="header-text"><h1>System Health</h1><p>Diagnostics</p></div></div><button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark');document.body.classList.toggle('dark')">🌓 Toggle</button></div><div class="status-pill"><div class="dot ${dbOk ? '' : 'danger'}"></div>${dbOk ? 'All Systems Operational' : 'System Outage'}</div><div class="grid"><div class="card"><div class="card-label">API Status</div><div class="card-val" style="color:var(--success)">Online</div></div><div class="card"><div class="card-label">Database</div><div class="card-val" style="color:${dbOk ? 'var(--success)' : 'var(--danger)'}">${dbOk ? 'Connected' : 'Unreachable'}</div></div><div class="card"><div class="card-label">Memory</div><div class="card-val">${memoryUsed} MB</div></div><div class="card"><div class="card-label">Uptime</div><div class="card-val">${Math.floor(health.uptime)}s</div></div><div class="card"><div class="card-label">Platform</div><div class="card-val">${health.platform}</div></div><div class="card"><div class="card-label">Version</div><div class="card-val">${health.version}</div></div></div>${!dbOk && !IS_PRODUCTION ? `<div class="card" style="border-color:var(--danger)"><div class="card-label">DB Error (dev only)</div><div class="card-val" style="font-size:1rem;color:var(--danger)">${escapeHtml(dbError)}</div></div>` : ''}<div class="actions"><a href="/" class="btn btn-primary">← Back Home</a></div></div></body></html>`);
  }

  res.status(dbOk ? 200 : 503).json({ success: dbOk, data: health });
}));

// 🔧 TEMP ROUTE: Run this once to verify all existing users in your database
app.get("/api/auth/verify-all", catchAsync(async (_req, res) => {
  const db = await getDB();
  const result = await db.collection("user").updateMany({}, { $set: { emailVerified: true } });
  ok(res, { message: `Verified ${result.modifiedCount} users successfully. You can now log in with Google.` });
}));

app.get("/api/home", catchAsync(async (_req, res) => {
  const [tCol, gCol, aCol, nCol, eCol] = await Promise.all([teachersCol(), governingCol(), articlesCol(), noticesCol(), eventsCol()]);
  const [principal, vicePrincipal, chairman, teachers, articles, notices, upcomingEvents] = await Promise.all([
    tCol.findOne({ role: "principal" }), 
    tCol.findOne({ role: "vice-principal" }), 
    gCol.findOne({ isChairman: true }),
    tCol.find({ role: "teacher" }).sort({ order: 1 }).toArray(), // 🔧 FIXED: Removed .limit(8) so ALL teachers show
    aCol.find({}).sort({ createdAt: -1 }).limit(3).toArray(),
    nCol.find({}).sort({ featured: -1, createdAt: -1 }).limit(4).toArray(),
    eCol.find({}).sort({ date: 1 }).limit(3).toArray(),
  ]);
  ok(res, { hero: { slides: HERO_SLIDES, logo: LOGO_URL }, principal, vicePrincipal, chairman, teachers, latestArticles: articles, latestNotices: notices, upcomingEvents });
}));

app.get("/api/docs", (_req, res) => {
  const endpoints = [
    { method: "GET", path: "/api/health", desc: "System health check" },
    { method: "GET", path: "/api/home", desc: "Homepage aggregate" },
    { method: "GET", path: "/api/stats", desc: "Platform statistics" },
    { method: "GET", path: "/api/settings", desc: "Global settings" },
    { method: "PUT", path: "/api/settings", desc: "Update settings (admin)" },
    { method: "GET", path: "/api/users/me", desc: "Current user profile" },
    { method: "GET", path: "/api/users", desc: "List users (admin)" },
    { method: "POST", path: "/api/users/:id/make-admin", desc: "Promote user (admin)" },
    { method: "POST", path: "/api/users/:id/make-member", desc: "Demote user (admin)" },
    { method: "DELETE", path: "/api/users/:id", desc: "Delete user (admin)" },
    { method: "GET", path: "/api/notices", desc: "List notices" },
    { method: "POST", path: "/api/notices", desc: "Create notice (admin)" },
    { method: "PATCH", path: "/api/notices/:id", desc: "Update notice (admin)" },
    { method: "DELETE", path: "/api/notices/:id", desc: "Delete notice (admin)" },
    { method: "GET", path: "/api/articles", desc: "List articles" },
    { method: "GET", path: "/api/articles/slug/:slug", desc: "Article by slug" },
    { method: "POST", path: "/api/articles", desc: "Create article (admin)" },
    { method: "PATCH", path: "/api/articles/:id", desc: "Update article (admin)" },
    { method: "DELETE", path: "/api/articles/:id", desc: "Delete article (admin)" },
    { method: "GET", path: "/api/teachers", desc: "List faculty" },
    { method: "POST", path: "/api/teachers", desc: "Add faculty (admin)" },
    { method: "PATCH", path: "/api/teachers/:id", desc: "Update faculty (admin)" },
    { method: "DELETE", path: "/api/teachers/:id", desc: "Delete faculty (admin)" },
    { method: "GET", path: "/api/governing-body", desc: "List governing body" },
    { method: "POST", path: "/api/governing-body", desc: "Add member (admin)" },
    { method: "PATCH", path: "/api/governing-body/:id", desc: "Update member (admin)" },
    { method: "DELETE", path: "/api/governing-body/:id", desc: "Remove member (admin)" },
    { method: "GET", path: "/api/gallery", desc: "List gallery" },
    { method: "POST", path: "/api/gallery", desc: "Add image (admin)" },
    { method: "DELETE", path: "/api/gallery/:id", desc: "Delete image (admin)" },
    { method: "GET", path: "/api/events", desc: "List events" },
    { method: "POST", path: "/api/events", desc: "Create event (admin)" },
    { method: "PATCH", path: "/api/events/:id", desc: "Update event (admin)" },
    { method: "DELETE", path: "/api/events/:id", desc: "Delete event (admin)" },
    { method: "GET", path: "/api/achievements", desc: "List achievements" },
    { method: "POST", path: "/api/achievements", desc: "Add achievement (admin)" },
    { method: "DELETE", path: "/api/achievements/:id", desc: "Delete achievement (admin)" },
    { method: "GET", path: "/api/contacts", desc: "List messages (admin)" },
    { method: "POST", path: "/api/contacts", desc: "Submit message" },
    { method: "PATCH", path: "/api/contacts/:id", desc: "Update status (admin)" },
    { method: "DELETE", path: "/api/contacts/:id", desc: "Delete (admin)" },
    { method: "GET", path: "/api/admissions", desc: "List applications (admin)" },
    { method: "GET", path: "/api/admissions/:id", desc: "Get single application (admin)" },
    { method: "POST", path: "/api/admissions", desc: "Submit application (with 4 documents)" },
    { method: "PATCH", path: "/api/admissions/:id", desc: "Update status (admin)" },
    { method: "DELETE", path: "/api/admissions/:id", desc: "Delete (admin)" },
    { method: "GET", path: "/api/notifications", desc: "Admin notifications" },
    { method: "GET", path: "/api/activity", desc: "Activity log (admin)" },
    { method: "GET", path: "/api/search?q=query", desc: "Cross-collection search" },
    { method: "GET", path: "/api/export/:collection", desc: "Export data (admin)" },
    { method: "POST", path: "/api/upload", desc: "Upload image (admin)" },
    { method: "POST", path: "/api/upload/public", desc: "Upload admission document (public, rate-limited)" },
    { method: "GET", path: "/api/proxy/image?url=...", desc: "CORS-safe image proxy (whitelisted hosts)" },
  ];

  const rows = endpoints.map(e => {
    const cls = e.method === "GET" ? "badge-get" : e.method === "POST" ? "badge-post" : e.method === "PUT" || e.method === "PATCH" ? "badge-put" : "badge-del";
    return `<div class="list-item"><span class="badge ${cls}">${e.method}</span><div class="list-content"><div class="list-title" style="font-family:var(--mono);font-size:.9rem">${escapeHtml(e.path)}</div><div class="list-desc">${escapeHtml(e.desc)}</div></div></div>`;
  }).join("");

  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>API Docs | Oasis BIAM</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${PREMIUM_CSS}</style></head><body><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="container"><div class="header"><div class="header-left"><img src="${LOGO_URL}" class="logo"><div class="header-text"><h1>API Documentation</h1><p>v${API_VERSION} · ${endpoints.length} endpoints</p></div></div><button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark');document.body.classList.toggle('dark')">🌓 Toggle</button></div><div class="status-pill"><div class="dot"></div> All Systems Operational</div><div class="list">${rows}</div><div class="actions"><a href="/" class="btn btn-primary">← Back Home</a><a href="/api/health" class="btn btn-outline">Health Check</a></div></div></body></html>`);
});

/* ==========================================================================
 * SECTION 17: CONFIG & STATS
 * ========================================================================== */

app.get("/api/config/auth", catchAsync(async (_req, res) => {
  ok(res, { authBaseURL: BETTER_AUTH_URL, clientOrigin: CLIENT_URL, googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID), emailVerification: RESEND_API_KEY ? "resend" : "console", environment: process.env.NODE_ENV, version: API_VERSION });
}));

app.get("/api/stats", catchAsync(async (_req, res) => {
  const [aCol, nCol, tCol, adCol, cCol, gCol, eCol, achCol, uCol] = await Promise.all([articlesCol(), noticesCol(), teachersCol(), admissionsCol(), contactsCol(), galleryCol(), eventsCol(), achievementsCol(), usersCol()]);
  const [articlesCount, noticesCount, teachersCount, pendingAdmissions, unreadMessages, galleryCount, eventsCount, achievementsCount, totalUsers] = await Promise.all([
    aCol.countDocuments(), nCol.countDocuments(), tCol.countDocuments(), adCol.countDocuments({ status: "pending" }), cCol.countDocuments({ status: "new" }), gCol.countDocuments(), eCol.countDocuments(), achCol.countDocuments(), uCol.countDocuments(),
  ]);
  ok(res, { students: 1250, years: 21, library: 5000, articlesCount, noticesCount, teachersCount, pendingAdmissions, unreadMessages, galleryCount, eventsCount, achievementsCount, totalUsers });
}));

/* ==========================================================================
 * SECTION 18: SETTINGS & USERS
 * ========================================================================== */

app.get("/api/settings", catchAsync(async (_req, res) => {
  const col = await settingsCol();
  const existing = await col.findOne({ _id: "global_settings" as any });
  ok(res, existing || { siteName: "Oasis BIAM Laboratory School", tagline: "Nurturing Excellence", address: "Barhatta Road, Netrokona", phone: "01724-483490", email: "info@oasisbiam.edu.bd", facebook: "", youtube: "" });
}));

app.put("/api/settings", requireAdmin, catchAsync(async (req, res) => {
  const col = await settingsCol();
  const { _id, ...update } = req.body;
  await col.updateOne({ _id: "global_settings" as any }, { $set: { ...update, updatedAt: new Date() } }, { upsert: true });
  await logActivity(req, "settings.update", "settings");
  msg(res, "Settings updated");
}));

app.get("/api/users/me", requireAuth, catchAsync(async (req, res) => {
  const col = await usersCol();
  const user = await col.findOne({ email: req.user!.email });
  if (!user) throw new AppError("User not found", 404);
  const { password, ...safe } = user;
  ok(res, safe);
}));

app.get("/api/users", requireAdmin, catchAsync(async (req, res) => {
  const col = await usersCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await col.countDocuments();
  const users = await col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, users.map(u => { const { password, ...s } = u; return s; }), page, limit, total);
}));

app.post("/api/users/:id/make-admin", requireAdmin, catchAsync(async (req, res) => {
  const col = await usersCol();
  await col.updateOne({ _id: parseId(req.params.id) }, { $set: { role: "admin" } });
  await logActivity(req, "user.promote", "user", req.params.id);
  msg(res, "User promoted to admin");
}));

app.post("/api/users/:id/make-member", requireAdmin, catchAsync(async (req, res) => {
  const col = await usersCol();
  const target = await col.findOne({ _id: parseId(req.params.id) });
  if (!target) throw new AppError("User not found", 404);
  if (target.email === req.user!.email) throw new AppError("Cannot demote yourself", 400);
  await col.updateOne({ _id: parseId(req.params.id) }, { $set: { role: "member" } });
  await logActivity(req, "user.demote", "user", req.params.id);
  msg(res, "User demoted");
}));

app.delete("/api/users/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await usersCol();
  const target = await col.findOne({ _id: parseId(req.params.id) });
  if (!target) throw new AppError("User not found", 404);
  if (target.email === req.user!.email) throw new AppError("Cannot delete yourself", 400);
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "user.delete", "user", req.params.id);
  msg(res, "User deleted");
}));

/* ==========================================================================
 * SECTION 19: NOTICES & ARTICLES
 * ========================================================================== */

app.get("/api/notices", catchAsync(async (req, res) => {
  const col = await noticesCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const filter: Filter<Document> = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.featured === "true") filter.featured = true;
  const total = await col.countDocuments(filter);
  const data = await col.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/notices/:id", catchAsync(async (req, res) => {
  const col = await noticesCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Notice not found", 404);
  ok(res, doc);
}));

app.post("/api/notices", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "content"]);
  const col = await noticesCol();
  const doc = {
    title: cleanString(req.body.title), content: sanitizeInput(cleanString(req.body.content)),
    category: cleanString(req.body.category, "General"), featured: !!req.body.featured,
    authorId: req.user!.id, authorName: req.user!.name, createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  await logActivity(req, "notice.create", "notice", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/notices/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await noticesCol();
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await col.findOneAndUpdate({ _id: parseId(req.params.id) }, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Notice not found", 404);
  await logActivity(req, "notice.update", "notice", req.params.id);
  ok(res, result);
}));

app.delete("/api/notices/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await noticesCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "notice.delete", "notice", req.params.id);
  msg(res, "Notice deleted");
}));

app.get("/api/articles", catchAsync(async (req, res) => {
  const col = await articlesCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const filter: Filter<Document> = {};
  if (req.query.category) filter.category = req.query.category;
  const total = await col.countDocuments(filter);
  const data = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/articles/:id", catchAsync(async (req, res) => {
  const col = await articlesCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Article not found", 404);
  ok(res, doc);
}));

app.get("/api/articles/slug/:slug", catchAsync(async (req, res) => {
  const col = await articlesCol();
  const doc = await col.findOne({ slug: req.params.slug });
  if (!doc) throw new AppError("Article not found", 404);
  await col.updateOne({ _id: doc._id }, { $inc: { views: 1 } });
  ok(res, doc);
}));

app.post("/api/articles", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "content"]);
  const col = await articlesCol();
  const content = cleanString(req.body.content);
  const doc = {
    title: cleanString(req.body.title), slug: slugify(req.body.title), excerpt: truncate(content, 150),
    content: sanitizeInput(content), coverImage: req.body.coverImage || null, category: cleanString(req.body.category, "Education"),
    authorId: req.user!.id, authorName: req.user!.name, views: 0, published: true, createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  await logActivity(req, "article.create", "article", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/articles/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await articlesCol();
  const update: any = { ...req.body, updatedAt: new Date() }; delete update._id;
  if (update.title) update.slug = slugify(update.title);
  const result = await col.findOneAndUpdate({ _id: parseId(req.params.id) }, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Article not found", 404);
  await logActivity(req, "article.update", "article", req.params.id);
  ok(res, result);
}));

app.delete("/api/articles/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await articlesCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "article.delete", "article", req.params.id);
  msg(res, "Article deleted");
}));

/* ==========================================================================
 * SECTION 20: TEACHERS, GOVERNING BODY, GALLERY, EVENTS, ACHIEVEMENTS
 * ========================================================================== */

app.get("/api/teachers", catchAsync(async (req, res) => {
  const col = await teachersCol();
  const filter: Filter<Document> = {};
  if (req.query.role) filter.role = req.query.role;
  ok(res, await col.find(filter).sort({ order: 1, createdAt: -1 }).toArray());
}));

app.get("/api/teachers/:id", catchAsync(async (req, res) => {
  const col = await teachersCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Teacher not found", 404);
  ok(res, doc);
}));

app.post("/api/teachers", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "role"]);
  const col = await teachersCol();
  const doc = {
    name: cleanString(req.body.name), role: cleanString(req.body.role, "teacher"), designation: cleanString(req.body.designation, "Teacher"),
    subject: cleanString(req.body.subject), image: req.body.image || null, bio: sanitizeInput(cleanString(req.body.bio)),
    email: cleanString(req.body.email), phone: cleanString(req.body.phone), qualification: cleanString(req.body.qualification),
    experience: cleanString(req.body.experience), order: req.body.order || 999, createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  await logActivity(req, "teacher.create", "teacher", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/teachers/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await teachersCol();
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await col.findOneAndUpdate({ _id: parseId(req.params.id) }, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Teacher not found", 404);
  await logActivity(req, "teacher.update", "teacher", req.params.id);
  ok(res, result);
}));

app.delete("/api/teachers/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await teachersCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "teacher.delete", "teacher", req.params.id);
  msg(res, "Teacher deleted");
}));

app.get("/api/governing-body", catchAsync(async (_req, res) => {
  const col = await governingCol();
  ok(res, await col.find({}).sort({ isChairman: -1, order: 1, createdAt: 1 }).toArray());
}));

app.get("/api/governing-body/:id", catchAsync(async (req, res) => {
  const col = await governingCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Member not found", 404);
  ok(res, doc);
}));

// 🔧 UPDATED: POST now saves the message
app.post("/api/governing-body", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "position"]);
  const col = await governingCol();
  if (req.body.isChairman) await col.updateMany({}, { $set: { isChairman: false } });
  
  const doc = { 
    name: cleanString(req.body.name), 
    position: cleanString(req.body.position), 
    image: req.body.image || null, 
    isChairman: !!req.body.isChairman, 
    order: req.body.order || 999, 
    message: sanitizeInput(cleanString(req.body.message)), // <-- ADDED
    createdAt: new Date(), 
    updatedAt: new Date() 
  };
  
  const result = await col.insertOne(doc);
  await logActivity(req, "governingBody.create", "governingBody", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

// 🔧 NEW: PATCH route so you can edit the message later
app.patch("/api/governing-body/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await governingCol();
  const update: any = { ...req.body, updatedAt: new Date() }; 
  delete update._id;
  
  if (update.message !== undefined) {
    update.message = sanitizeInput(cleanString(update.message));
  }

  // If setting as chairman, demote others
  if (req.body.isChairman) {
    await col.updateMany({ _id: { $ne: parseId(req.params.id) } }, { $set: { isChairman: false } });
  }
  
  const result = await col.findOneAndUpdate(
    { _id: parseId(req.params.id) }, 
    { $set: update }, 
    { returnDocument: "after" }
  );
  
  if (!result) throw new AppError("Member not found", 404);
  await logActivity(req, "governingBody.update", "governingBody", req.params.id);
  ok(res, result);
}));

app.delete("/api/governing-body/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await governingCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "governingBody.delete", "governingBody", req.params.id);
  msg(res, "Member removed");
}));

app.get("/api/gallery", catchAsync(async (req, res) => {
  const col = await galleryCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await col.countDocuments();
  const data = await col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.post("/api/gallery", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["image"]);
  const col = await galleryCol();
  const doc = { title: cleanString(req.body.title, "Untitled"), image: req.body.image, caption: cleanString(req.body.caption), category: cleanString(req.body.category, "General"), createdAt: new Date() };
  const result = await col.insertOne(doc);
  await logActivity(req, "gallery.create", "gallery", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.delete("/api/gallery/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await galleryCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "gallery.delete", "gallery", req.params.id);
  msg(res, "Image deleted");
}));

app.get("/api/events", catchAsync(async (_req, res) => {
  const col = await eventsCol();
  ok(res, await col.find({}).sort({ date: 1 }).toArray());
}));

app.get("/api/events/:id", catchAsync(async (req, res) => {
  const col = await eventsCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Event not found", 404);
  ok(res, doc);
}));

app.post("/api/events", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "date"]);
  const col = await eventsCol();
  const doc = {
    title: cleanString(req.body.title), date: cleanString(req.body.date), time: cleanString(req.body.time),
    location: cleanString(req.body.location), description: sanitizeInput(cleanString(req.body.description)),
    image: req.body.image || null, category: cleanString(req.body.category, "General"), createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  await logActivity(req, "event.create", "event", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/events/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await eventsCol();
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await col.findOneAndUpdate({ _id: parseId(req.params.id) }, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Event not found", 404);
  await logActivity(req, "event.update", "event", req.params.id);
  ok(res, result);
}));

app.delete("/api/events/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await eventsCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "event.delete", "event", req.params.id);
  msg(res, "Event deleted");
}));

app.get("/api/achievements", catchAsync(async (req, res) => {
  const col = await achievementsCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await col.countDocuments();
  const data = await col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/achievements/:id", catchAsync(async (req, res) => {
  const col = await achievementsCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Achievement not found", 404);
  ok(res, doc);
}));

app.post("/api/achievements", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title"]);
  const col = await achievementsCol();
  const doc = {
    title: cleanString(req.body.title), description: sanitizeInput(cleanString(req.body.description)),
    year: cleanString(req.body.year, new Date().getFullYear().toString()), image: req.body.image || null,
    category: cleanString(req.body.category, "General"), createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await col.insertOne(doc);
  await logActivity(req, "achievement.create", "achievement", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/achievements/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await achievementsCol();
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await col.findOneAndUpdate({ _id: parseId(req.params.id) }, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Achievement not found", 404);
  ok(res, result);
}));

app.delete("/api/achievements/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await achievementsCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "achievement.delete", "achievement", req.params.id);
  msg(res, "Achievement deleted");
}));

/* ==========================================================================
 * SECTION 21: CONTACTS, ADMISSIONS, NOTIFICATIONS, ACTIVITY
 * ========================================================================== */

app.post("/api/contacts", catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "email", "message"]);
  const col = await contactsCol();
  const doc = {
    name: cleanString(req.body.name), email: cleanString(req.body.email), phone: cleanString(req.body.phone),
    subject: cleanString(req.body.subject), message: sanitizeInput(cleanString(req.body.message)),
    status: "new", createdAt: new Date(), updatedAt: new Date(),
  };
  await col.insertOne(doc);
  await createNotification("New Contact Message", `${doc.name} sent a message.`);
  msg(res, "Message sent successfully", 201);
}));

app.get("/api/contacts", requireAdmin, catchAsync(async (req, res) => {
  const col = await contactsCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const filter: Filter<Document> = {};
  if (req.query.status) filter.status = req.query.status;
  const total = await col.countDocuments(filter);
  const data = await col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.patch("/api/contacts/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await contactsCol();
  const result = await col.updateOne({ _id: parseId(req.params.id) }, { $set: { status: req.body.status, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new AppError("Message not found", 404);
  msg(res, "Status updated");
}));

app.delete("/api/contacts/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await contactsCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "contact.delete", "contact", req.params.id);
  msg(res, "Message deleted");
}));

app.post("/api/admissions", catchAsync(async (req, res) => {
  validateRequired(req.body, [
    "studentName", "fatherName", "motherName", "classApplyingFor", "phone",
    "birthCertificateImage", "previousSchoolCertificateImage",
    "passportPhotosImage", "parentNidImage",
  ]);

  const col = await admissionsCol();
  const doc = {
    studentName: cleanString(req.body.studentName),
    fatherName: cleanString(req.body.fatherName),
    motherName: cleanString(req.body.motherName),
    birthDate: cleanString(req.body.birthDate),
    bloodGroup: cleanString(req.body.bloodGroup),
    classApplyingFor: cleanString(req.body.classApplyingFor),
    previousClass: cleanString(req.body.previousClass),
    phone: cleanString(req.body.phone),
    email: cleanString(req.body.email),
    currentAddress: cleanString(req.body.currentAddress),
    permanentAddress: cleanString(req.body.permanentAddress),
    birthCertificateImage: cleanString(req.body.birthCertificateImage),
    previousSchoolCertificateImage: cleanString(req.body.previousSchoolCertificateImage),
    passportPhotosImage: cleanString(req.body.passportPhotosImage),
    parentNidImage: cleanString(req.body.parentNidImage),
    status: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await col.insertOne(doc);
  await createNotification("New Admission", `${doc.studentName} applied for ${doc.classApplyingFor}.`);
  msg(res, "Application submitted successfully", 201);
}));

app.get("/api/admissions", requireAdmin, catchAsync(async (req, res) => {
  const col = await admissionsCol();
  const filter: Filter<Document> = {};
  if (req.query.status) filter.status = req.query.status;
  ok(res, await col.find(filter).sort({ createdAt: -1 }).toArray());
}));

app.get("/api/admissions/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await admissionsCol();
  const doc = await col.findOne({ _id: parseId(req.params.id) });
  if (!doc) throw new AppError("Application not found", 404);
  ok(res, doc);
}));

app.patch("/api/admissions/:id", requireAdmin, catchAsync(async (req, res) => {
  if (!["pending", "approved", "rejected"].includes(req.body.status)) throw new AppError("Invalid status", 400);
  const col = await admissionsCol();
  const result = await col.updateOne({ _id: parseId(req.params.id) }, { $set: { status: req.body.status, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new AppError("Application not found", 404);
  await logActivity(req, "admission.update", "admission", req.params.id, { status: req.body.status });
  msg(res, `Application ${req.body.status}`);
}));

app.delete("/api/admissions/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await admissionsCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  await logActivity(req, "admission.delete", "admission", req.params.id);
  msg(res, "Application deleted");
}));

app.get("/api/notifications", requireAdmin, catchAsync(async (req, res) => {
  const col = await notificationsCol();
  const { skip, limit } = getPagination(req.query.page as string, req.query.limit as string);
  ok(res, await col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray());
}));

app.post("/api/notifications/:id/read", requireAdmin, catchAsync(async (req, res) => {
  const col = await notificationsCol();
  await col.updateOne({ _id: parseId(req.params.id) }, { $set: { read: true, readAt: new Date() } });
  msg(res, "Marked as read");
}));

app.delete("/api/notifications/:id", requireAdmin, catchAsync(async (req, res) => {
  const col = await notificationsCol();
  await col.deleteOne({ _id: parseId(req.params.id) });
  msg(res, "Notification deleted");
}));

app.get("/api/activity", requireAdmin, catchAsync(async (req, res) => {
  const col = await activityCol();
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await col.countDocuments();
  const data = await col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

/* ==========================================================================
 * SECTION 22: SEARCH, EXPORT, UPLOAD, IMAGE PROXY
 * ========================================================================== */

app.get("/api/search", catchAsync(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return ok(res, { teachers: [], articles: [], notices: [], events: [], query: "", counts: { teachers: 0, articles: 0, notices: 0, events: 0 } });
  const safeRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const [tCol, aCol, nCol, eCol] = await Promise.all([teachersCol(), articlesCol(), noticesCol(), eventsCol()]);
  const [teachers, articles, notices, events] = await Promise.all([
    tCol.find({ $or: [{ name: safeRegex }, { subject: safeRegex }, { bio: safeRegex }] }).limit(10).toArray(),
    aCol.find({ $or: [{ title: safeRegex }, { content: safeRegex }, { category: safeRegex }] }).limit(10).toArray(),
    nCol.find({ $or: [{ title: safeRegex }, { content: safeRegex }, { category: safeRegex }] }).limit(10).toArray(),
    eCol.find({ $or: [{ title: safeRegex }, { description: safeRegex }, { location: safeRegex }] }).limit(10).toArray(),
  ]);
  ok(res, { teachers, articles, notices, events, query: q, counts: { teachers: teachers.length, articles: articles.length, notices: notices.length, events: events.length } });
}));

const EXPORTABLE = ["notices", "articles", "teachers", "governingBody", "gallery", "events", "achievements", "admissions", "contacts"];

app.get("/api/export/:collection", requireAdmin, catchAsync(async (req, res) => {
  const name = req.params.collection;
  if (!EXPORTABLE.includes(name)) throw new AppError(`Collection not exportable: ${name}`, 400);
  const db = await getDB();
  const data = await db.collection(name).find({}).toArray();
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(data);
}));

const publicUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many uploads. Please try again later.",
  },
});

app.post(
  "/api/upload/public",
  publicUploadLimiter,
  upload.single("image"),
  catchAsync(async (req, res) => {

    if (!req.file) {
      throw new AppError("No image file provided. Use field 'image'.", 400);
    }

    if (!IMGBB_API_KEY) {
      throw new AppError("IMGBB_API_KEY is missing from backend environment.", 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const form = new FormData();
      form.append("image", req.file.buffer.toString("base64"));
      const endpoint = new URL("https://api.imgbb.com/1/upload");
      endpoint.searchParams.set("key", IMGBB_API_KEY);

      const imgResponse = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      const imgData: any = await imgResponse.json().catch(() => null);
      const imageUrl = imgData?.data?.url;

      if (!imgResponse.ok || imgData?.success !== true || !imageUrl) {
        console.error("IMG BB UPLOAD FAILED:", { status: imgResponse.status, response: imgData });
        throw new AppError(imgData?.error?.message || `ImgBB upload failed. HTTP ${imgResponse.status}`, 502);
      }

      const displayUrl = imgData?.data?.display_url || imageUrl;
      console.log("✅ PUBLIC IMAGE UPLOAD SUCCESS");

      return res.status(200).json({
        success: true,
        url: imageUrl,
        data: {
          url: imageUrl,
          displayUrl: displayUrl,
        },
      });

    } catch (error: any) {
      if (error instanceof AppError) throw error;
      console.error("PUBLIC UPLOAD ERROR:", error);
      if (controller.signal.aborted) {
        throw new AppError("ImgBB upload timed out. Please try again.", 504);
      }
      throw new AppError("Unable to connect to ImgBB. Check your backend internet connection.", 502);
    } finally {
      clearTimeout(timeout);
    }
  })
);

app.post("/api/upload", requireAdmin, upload.single("image"), catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No image file provided. Use field 'image'.", 400);
  if (!IMGBB_API_KEY) throw new AppError("Image upload not configured", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));
    const endpoint = new URL("https://api.imgbb.com/1/upload");
    endpoint.searchParams.set("key", IMGBB_API_KEY);
    const resp = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
    const payload: any = await resp.json().catch(() => null);
    if (!resp.ok || !payload?.success || !payload.data?.url) throw new AppError(payload?.error?.message || `ImgBB HTTP ${resp.status}`, 502);
    ok(res, { url: payload.data.url, displayUrl: payload.data.display_url || payload.data.url, deleteUrl: payload.data.delete_url || null });
  } finally { clearTimeout(timeout); }
}));

const IMAGE_PROXY_HOSTS = new Set([
  "i.ibb.co.com",
  "i.ibb.co",
  "imgbb.com",
  "images.unsplash.com",
]);

const imageProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many image proxy requests." },
});

app.get(
  "/api/proxy/image",
  imageProxyLimiter,
  catchAsync(async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) throw new AppError("Missing 'url' query parameter", 400);

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new AppError("Invalid URL format", 400);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new AppError("Only http/https URLs are allowed", 400);
    }

    if (!IMAGE_PROXY_HOSTS.has(parsed.hostname)) {
      throw new AppError(`Host not allowed: ${parsed.hostname}`, 403);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const upstream = await fetch(parsed.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OasisBIAM/1.0)",
          Accept: "image/*",
        },
      });

      if (!upstream.ok) {
        throw new AppError(`Upstream responded with ${upstream.status}`, 502);
      }

      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new AppError(`Upstream returned non-image content: ${contentType}`, 502);
      }

      const cacheControl = upstream.headers.get("cache-control") || "public, max-age=86400";
      const buffer = Buffer.from(await upstream.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Length", String(buffer.length));
      res.send(buffer);
    } finally {
      clearTimeout(timeout);
    }
  })
);

/* ==========================================================================
 * SECTION 23: GLOBAL ERROR HANDLING
 * ========================================================================== */

app.use((req, res, next) => next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404)));

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "Internal Server Error";
  if (req.headers.accept?.includes("text/html") && !req.path.startsWith("/api")) {
    const title = statusCode === 404 ? "Page Not Found" : "Server Error";
    return res.status(statusCode).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title} | Oasis BIAM</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${PREMIUM_CSS}</style></head><body><div class="blob blob-1"></div><div class="container"><div class="header"><div class="header-left"><img src="${LOGO_URL}" class="logo"><div class="header-text"><h1>${title}</h1><p>Error ${statusCode}</p></div></div><button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark');document.body.classList.toggle('dark')">🌓 Toggle</button></div><h2 class="hero-title"><span class="highlight">${statusCode}</span></h2><p class="hero-desc">${escapeHtml(message)}</p><div class="actions"><a href="/" class="btn btn-primary">← Back Home</a></div></div></body></html>`);
  }
  console.error(`🔥 [${statusCode}] ${req.method} ${req.originalUrl}:`, err.message);
  if (IS_PRODUCTION) res.status(statusCode).json({ success: false, message, requestId: req.requestId });
  else res.status(statusCode).json({ success: false, message, stack: err.stack, requestId: req.requestId });
});

/* ==========================================================================
 * SECTION 24: EXPORT & STARTUP
 * ========================================================================== */

export default app;

if (!IS_VERCEL) {
  getDB().then(() => {
    app.listen(PORT, () => {
      console.log("──────────────────────────────────────────────");
      console.log(`🚀 Server running → http://localhost:${PORT}`);
      console.log(`🌐 Client URL    → ${CLIENT_URL}`);
      console.log(`🔐 Auth URL      → ${BETTER_AUTH_URL}`);
      console.log(`✅ Environment   → ${process.env.NODE_ENV || "development"}`);
      console.log(`📦 API Version   → ${API_VERSION}`);
      console.log("──────────────────────────────────────────────");
    });
  }).catch((err) => {
    console.error("❌ Startup DB connection failed:", err.message);
    app.listen(PORT, () => console.log(`⚠️ Server running (DB disconnected) on port ${PORT}`));
  });
}