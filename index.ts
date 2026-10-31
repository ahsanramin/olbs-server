/* ==========================================================================
 *  OASIS BIAM LABORATORY SCHOOL — ULTIMATE ENTERPRISE SERVER
 *  ==========================================================================
 *  File: index.ts
 *  Author: Ahsan Labib Ramin
 *  Architecture: Monolithic SaaS Backend (Vercel Serverless + Express + MongoDB)
 *  
 *  FEATURES:
 *  ✅ Zero Fake Data (No seeding) 
 *  ✅ Auto-Promote SPECIFIC ADMIN_EMAIL to admin via Better Auth hooks
 *  ✅ Full CRUD + Bulk operations for 13 MongoDB collections
 *  ✅ Advanced search, filtering, pagination
 *  ✅ Complete analytics + activity log
 *  ✅ Better Auth (Email/Password + Google OAuth)
 *  ✅ ImgBB image upload with 45s timeout and 5MB limit
 *  ✅ Premium branded HTML pages (/, /health, /home, /404, /500, /docs)
 *  ✅ Vercel Serverless-optimized (maxPoolSize: 1, export default app)
 *  ✅ Comprehensive error handling, rate limiting, validation
 *  
 *  DEPLOYMENT:
 *  - Vercel: Uses `export default app` for serverless deployment
 *  - Render/Railway: Uses `app.listen()` for traditional Node.js hosting
 *  - Local: Run `npm run dev` for hot reload via tsx
 * ========================================================================== */

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
import { randomUUID } from "crypto";

/* ==========================================================================
 * SECTION 2: ENVIRONMENT CONFIGURATION
 * ========================================================================== */

/** Server port. Defaults to 5000. Vercel assigns its own PORT. */
const PORT = Number(process.env.PORT || 5000);

/** Flag indicating if the app is running in production mode. */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Flag indicating if the app is running on Vercel Serverless. */
const IS_VERCEL = !!process.env.VERCEL;

/** The frontend application URL. */
const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");

/** The Better Auth base URL. */
const BETTER_AUTH_URL = (process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

/** MongoDB connection URI. */
const MONGODB_URI = process.env.MONGODB_URI;

/** The MongoDB database name. */
const DB_NAME = process.env.DB_NAME;

/** ImgBB API key for image hosting. */
const IMGBB_API_KEY = process.env.IMGBB_API_KEY?.trim();

/** Resend API key for email delivery. */
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();

/** The "from" address for outgoing emails. */
const EMAIL_FROM = process.env.EMAIL_FROM?.trim();

/** Root admin display name. */
const ADMIN_NAME = process.env.ADMIN_NAME || "Oasis BIAM Administrator";

/** Root admin email. MUST BE SET in .env */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();

/** Root admin password. (Optional, for email login) */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/** Cookie SameSite policy for Better Auth. */
const AUTH_COOKIE_SAME_SITE = (process.env.AUTH_COOKIE_SAME_SITE || (IS_PRODUCTION ? "none" : "lax")) as
  | "lax" | "strict" | "none";

/** The school's default logo URL. */
const LOGO_URL = "https://i.ibb.co.com/7NzsPGvc/logo.jpg";

/** Default hero slider images. */
const HERO_SLIDES = [
  "https://i.ibb.co.com/j9p9vNfJ/images-1.jpg",
  "https://i.ibb.co.com/67z0dmbS/images.jpg",
];

/** API version for headers. */
const API_VERSION = "1.0.0";

/** Global flag to skip email verification during admin seeding. */
let isSeedingAdmin = false;

/* ==========================================================================
 * SECTION 3: TYPE DEFINITIONS (COMPLETE SCHEMAS)
 * ========================================================================== */

/**
 * User document schema (managed by Better Auth + extended fields).
 */
interface UserDoc extends Document {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  role: "admin" | "member";
  phone?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notice/announcement document schema.
 */
interface NoticeDoc extends Document {
  title: string;
  content: string;
  category: string;
  featured: boolean;
  authorId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Article/blog post document schema.
 */
interface ArticleDoc extends Document {
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
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Teacher/faculty document schema.
 */
interface TeacherDoc extends Document {
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
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Governing body member document schema.
 */
interface GoverningBodyDoc extends Document {
  name: string;
  position: string;
  image: string | null;
  isChairman: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Contact form submission document schema.
 */
interface ContactDoc extends Document {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  status: "new" | "read" | "replied" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admission application document schema.
 */
interface AdmissionDoc extends Document {
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
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admin notification document schema.
 */
interface NotificationDoc extends Document {
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}

/**
 * Global settings document schema.
 */
interface SettingsDoc extends Document {
  _id: string;
  siteName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  facebook: string;
  youtube: string;
  twitter: string;
  instagram: string;
  updatedAt: Date;
}

/**
 * Gallery image document schema.
 */
interface GalleryDoc extends Document {
  title: string;
  image: string;
  caption: string;
  category: string;
  createdAt: Date;
}

/**
 * Event document schema.
 */
interface EventDoc extends Document {
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  image: string | null;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Achievement/award document schema.
 */
interface AchievementDoc extends Document {
  title: string;
  description: string;
  year: string;
  image: string | null;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Activity log entry document schema.
 */
interface ActivityDoc extends Document {
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, any>;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/* ==========================================================================
 * SECTION 4: FATAL ENVIRONMENT VALIDATION
 * ========================================================================== */

if (!MONGODB_URI || !DB_NAME) {
  console.error("❌ FATAL: MONGODB_URI and DB_NAME must be set in .env");
  process.exit(1);
}

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error("❌ FATAL: BETTER_AUTH_SECRET must be at least 32 characters");
  process.exit(1);
}

if (!IMGBB_API_KEY) {
  console.warn("⚠️ WARNING: IMGBB_API_KEY is missing. Image uploads will fail.");
}

if (!ADMIN_EMAIL) {
  console.warn("⚠️ WARNING: ADMIN_EMAIL is not set. Auto-promotion to admin will not work.");
}

/* ==========================================================================
 * SECTION 5: DATABASE CONNECTION
 * ========================================================================== */

/**
 * MongoDB Client for Serverless environments.
 * maxPoolSize: 1 is CRITICAL for Vercel - without it MongoDB Atlas
 * will hit connection limits and the app will crash with 500 errors.
 */
const mongoClient = new MongoClient(MONGODB_URI, {
  maxPoolSize: IS_VERCEL ? 1 : 25,
  minPoolSize: IS_VERCEL ? 0 : 5,
  serverSelectionTimeoutMS: 15000,
  retryWrites: true,
});

try {
  await mongoClient.connect();
  console.log(`✅ MongoDB connected → DB: ${DB_NAME}`);
} catch (error) {
  console.error("❌ MongoDB connection failed:", error);
  process.exit(1);
}

/** The MongoDB database instance. */
const db: Db = mongoClient.db(DB_NAME);

/* ==========================================================================
 * SECTION 6: COLLECTIONS
 * ========================================================================== */

const usersCol: Collection<UserDoc> = db.collection<UserDoc>("user");
const noticesCol: Collection<NoticeDoc> = db.collection<NoticeDoc>("notices");
const articlesCol: Collection<ArticleDoc> = db.collection<ArticleDoc>("articles");
const teachersCol: Collection<TeacherDoc> = db.collection<TeacherDoc>("teachers");
const governingCol: Collection<GoverningBodyDoc> = db.collection<GoverningBodyDoc>("governingBody");
const contactsCol: Collection<ContactDoc> = db.collection<ContactDoc>("contacts");
const admissionsCol: Collection<AdmissionDoc> = db.collection<AdmissionDoc>("admissions");
const notificationsCol: Collection<NotificationDoc> = db.collection<NotificationDoc>("notifications");
const settingsCol: Collection<SettingsDoc> = db.collection<SettingsDoc>("settings");
const galleryCol: Collection<GalleryDoc> = db.collection<GalleryDoc>("gallery");
const eventsCol: Collection<EventDoc> = db.collection<EventDoc>("events");
const achievementsCol: Collection<AchievementDoc> = db.collection<AchievementDoc>("achievements");
const activityCol: Collection<ActivityDoc> = db.collection<ActivityDoc>("activityLog");

/* ==========================================================================
 * SECTION 7: ERROR ARCHITECTURE
 * ========================================================================== */

/**
 * Custom operational error class.
 */
class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async wrapper that catches promise rejections.
 */
const catchAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler => {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};

/* ==========================================================================
 * SECTION 8: RESPONSE HELPERS
 * ========================================================================== */

const ok = (res: Response, data: any, status = 200) => {
  res.status(status).json({ success: true, data });
};

const msg = (res: Response, message: string, status = 200) => {
  res.status(status).json({ success: true, message });
};

const fail = (res: Response, message: string, status = 400) => {
  res.status(status).json({ success: false, message });
};

const paginated = (res: Response, items: any[], page: number, limit: number, total: number) => {
  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    },
  });
};

/* ==========================================================================
 * SECTION 9: UTILITY FUNCTIONS
 * ========================================================================== */

const parseId = (id: string): ObjectId => {
  try { return new ObjectId(id); } 
  catch { throw new AppError("Invalid ID format. Must be a 24-character hex string.", 400); }
};

const slugify = (text: string): string => {
  return text.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").substring(0, 100);
};

const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char] || char;
  });
};

const getPagination = (pageStr?: string, limitStr?: string) => {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitStr || "20", 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
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
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/javascript:/gi, "").replace(/on\w+=/gi, "");
};

const generateRequestId = (): string => randomUUID().split("-")[0];

async function logActivity(req: Request, action: string, entity: string, entityId?: string, details?: any): Promise<void> {
  try {
    await activityCol.insertOne({
      action, entity, entityId: entityId || null, details: details || {},
      actorId: req.user?.id || null, actorName: req.user?.name || "System", actorEmail: req.user?.email || null,
      ip: req.ip || null, userAgent: req.headers["user-agent"] || null, createdAt: new Date(),
    } as any);
  } catch (e) { console.error("⚠️ Activity log failed:", (e as Error).message); }
}

async function createNotification(title: string, message: string, type = "info"): Promise<void> {
  try { await notificationsCol.insertOne({ title, message, type: type as any, read: false, createdAt: new Date() } as any); }
  catch (e) { console.error("⚠️ Notification failed:", (e as Error).message); }
}

/* ==========================================================================
 * SECTION 10: BETTER AUTH CONFIGURATION (WITH AUTO-PROMOTION)
 * ========================================================================== */

async function sendVerificationEmail(user: { name?: string | null; email: string }, url: string) {
  if (isSeedingAdmin) return;
  const safeName = escapeHtml(user.name || "there");
  const safeUrl = escapeHtml(url);

  if (RESEND_API_KEY && EMAIL_FROM) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM, to: [user.email], subject: "Verify your Oasis BIAM account",
          html: `<div style="font-family:sans-serif;padding:20px"><h2>Verify your email</h2><p>Hello ${safeName},</p><p><a href="${safeUrl}" style="padding:10px 20px;background:#10b981;color:white;text-decoration:none;border-radius:5px">Verify Email</a></p></div>`,
        }),
      });
    } catch (e) { console.error("❌ Email send error:", e); }
  } else if (!IS_PRODUCTION) {
    console.warn("⚠️ Local dev verification URL:\n", url);
  }
}

const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  database: mongodbAdapter(db),
  trustedOrigins: [CLIENT_URL, "http://localhost:3000", "http://127.0.0.1:3000"],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => await sendVerificationEmail(user, url),
  },
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        requireEmailVerification: true,
        prompt: "select_account" as const,
      },
    },
  } : {}),
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  logger: { disabled: true },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      phone: { type: "string", required: false, defaultValue: "", input: true },
      address: { type: "string", required: false, defaultValue: "", input: true },
    },
  },
  
  // 👇 🔧 THE FIX: AUTO-PROMOTE SPECIFIC ADMIN EMAIL 👇
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Check if the newly created user matches the exact ADMIN_EMAIL from .env
          if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) {
            console.log(`👑 Auto-promoting ${user.email} to admin.`);
            await usersCol.updateOne(
              { email: user.email },
              { $set: { role: "admin" } }
            );
          }
        }
      }
    }
  },
  // 👆 END OF AUTO-PROMOTION FIX 👆

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: AUTH_COOKIE_SAME_SITE,
      secure: IS_PRODUCTION || AUTH_COOKIE_SAME_SITE === "none",
      httpOnly: true,
      path: "/",
    },
  },
});

/* ==========================================================================
 * SECTION 11: EXPRESS APP & MIDDLEWARE
 * ========================================================================== */

const app = express();
if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));

const allowedOrigins = new Set([CLIENT_URL, "http://localhost:3000", "http://127.0.0.1:3000"]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    return cb(new AppError(`Blocked by CORS: ${origin}`, 403));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
}));

app.use(morgan(IS_PRODUCTION ? "combined" : "dev"));

// Request ID + Performance Tracking
app.use((req, res, next) => {
  const requestId = generateRequestId();
  (req as any).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-API-Version", API_VERSION);
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 1000) console.warn(`⚠️ Slow request: ${req.method} ${req.originalUrl} (${duration}ms)`);
  });
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: new AppError("Too many requests, please try again later.", 429),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* ==========================================================================
 * SECTION 12: FILE UPLOAD (MULTER)
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
 * SECTION 13: AUTH GUARDS
 * ========================================================================== */

declare global {
  namespace Express {
    interface Request {
      user?: any;
      session?: any;
      requestId?: string;
    }
  }
}

app.use("/api", catchAsync(async (req, _res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session) {
      req.user = session.user;
      req.session = session.session;
    }
  } catch (e) { /* Ignore session errors */ }
  next();
}));

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError("Authentication required. Please log in.", 401));
  next();
};

const requireAdmin = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError("Authentication required.", 401));
  const dbUser = await usersCol.findOne({ email: req.user.email });
  if (!dbUser || dbUser.role !== "admin") return next(new AppError("Admin access required.", 403));
  req.user.role = "admin";
  next();
});

/* ==========================================================================
 * SECTION 14: PREMIUM SAAS CSS (MASSIVE)
 * ========================================================================== */

const PREMIUM_CSS = `
:root {
  --bg-base: #fafaf9;
  --bg-soft: #fef2f2;
  --bg-gradient: radial-gradient(circle at top left, #fee2e2, #fafaf9 70%);
  --panel: rgba(255, 255, 255, 0.7);
  --panel-hover: rgba(255, 255, 255, 0.9);
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.15);
  --text-main: #1c1917;
  --text-muted: #78716c;
  --text-subtle: #a8a29e;
  --accent: #dc2626;
  --accent-hover: #b91c1c;
  --accent-glow: rgba(220, 38, 38, 0.3);
  --btn-text: #ffffff;
  --highlight: #f59e0b;
  --highlight-glow: rgba(245, 158, 11, 0.3);
  --success: #059669;
  --success-bg: rgba(5, 150, 105, 0.1);
  --warning: #d97706;
  --warning-bg: rgba(217, 119, 6, 0.1);
  --danger: #dc2626;
  --danger-bg: rgba(220, 38, 38, 0.1);
  --info: #0284c7;
  --info-bg: rgba(2, 132, 199, 0.1);
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  --radius: 16px;
  --radius-sm: 8px;
  --radius-lg: 24px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.dark {
  --bg-base: #022c22;
  --bg-soft: #064e3b;
  --bg-gradient: radial-gradient(circle at top left, #064e3b, #022c22 70%);
  --panel: rgba(255, 255, 255, 0.03);
  --panel-hover: rgba(255, 255, 255, 0.06);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.15);
  --text-main: #ecfdf5;
  --text-muted: #6ee7b7;
  --text-subtle: #4ade80;
  --accent: #10b981;
  --accent-hover: #059669;
  --accent-glow: rgba(16, 185, 129, 0.4);
  --btn-text: #000000;
  --highlight: #06b6d4;
  --highlight-glow: rgba(6, 182, 212, 0.4);
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.15);
  --warning: #f59e0b;
  --warning-bg: rgba(245, 158, 11, 0.15);
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.15);
  --info: #3b82f6;
  --info-bg: rgba(59, 130, 246, 0.15);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: var(--font);
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

html {
  scroll-behavior: smooth;
  -webkit-text-size-adjust: 100%;
}

body {
  background-color: var(--bg-base);
  background-image: var(--bg-gradient);
  color: var(--text-main);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow-x: hidden;
  position: relative;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  z-index: -1;
  opacity: 0.2;
  animation: float 12s infinite ease-in-out alternate;
  pointer-events: none;
}
.blob-1 { background: var(--accent); width: 600px; height: 600px; top: -200px; left: -200px; }
.blob-2 { background: var(--highlight); width: 500px; height: 500px; bottom: -150px; right: -150px; animation-delay: -6s; }

.container {
  max-width: 1100px;
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 4rem;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow-2xl), 0 0 60px var(--accent-glow);
  position: relative;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3rem;
  gap: 1.5rem;
}
.header-left { display: flex; align-items: center; gap: 1.5rem; min-width: 0; }
.logo {
  width: 80px; height: 80px; border-radius: 20px;
  border: 2px solid var(--border); box-shadow: 0 0 20px var(--accent-glow);
  object-fit: cover; flex-shrink: 0;
}
.header-text h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2; }
.header-text p { font-size: 0.85rem; color: var(--text-muted); font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-top: 0.25rem; }

.theme-toggle {
  background: var(--panel); border: 1px solid var(--border); color: var(--text-main);
  padding: 12px 20px; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 0.9rem;
  display: flex; gap: 8px; align-items: center; transition: all 0.3s ease; flex-shrink: 0;
}
.theme-toggle:hover { border-color: var(--accent); background: var(--panel-hover); transform: translateY(-2px); box-shadow: 0 10px 20px var(--accent-glow); }

.status-pill {
  display: inline-flex; align-items: center; gap: 10px; background: var(--panel);
  border: 1px solid var(--border); padding: 10px 24px; border-radius: 30px;
  font-size: 0.85rem; font-weight: 800; color: var(--accent); margin-bottom: 2rem; box-shadow: var(--shadow-sm);
}
.dot { width: 12px; height: 12px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 15px var(--accent); animation: pulse 2s infinite; flex-shrink: 0; }
.dot.danger { background: var(--danger); box-shadow: 0 0 15px var(--danger); }
.dot.success { background: var(--success); box-shadow: 0 0 15px var(--success); }

.hero-title { font-size: 4rem; font-weight: 800; line-height: 1.1; margin-bottom: 1.5rem; letter-spacing: -2px; word-break: break-word; }
.highlight { background: linear-gradient(90deg, var(--accent), var(--highlight)); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.hero-desc { font-size: 1.15rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 3rem; max-width: 700px; font-weight: 500; }
.section-title { font-size: 1.5rem; font-weight: 800; margin: 3rem 0 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border); }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }

.card { background: var(--panel); border: 1px solid var(--border); padding: 2rem; border-radius: 20px; position: relative; overflow: hidden; transition: all 0.3s ease; }
.card::before { content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 4px; background: linear-gradient(90deg, var(--accent), transparent); opacity: 0; transition: opacity 0.3s; }
.card:hover { transform: translateY(-5px); border-color: var(--accent); box-shadow: 0 20px 40px -10px var(--accent-glow); background: var(--panel-hover); }
.card:hover::before { opacity: 1; }
.card-label { font-size: 0.8rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; }
.card-val { font-size: 1.6rem; font-weight: 800; display: flex; align-items: center; gap: 8px; word-break: break-word; }

.btn { text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 700; font-size: 1rem; display: inline-flex; align-items: center; gap: 10px; border: none; cursor: pointer; transition: all 0.3s ease; }
.btn-primary { background: linear-gradient(135deg, var(--accent), var(--highlight)); color: var(--btn-text); box-shadow: 0 10px 20px var(--accent-glow); }
.btn-primary:hover { transform: translateY(-3px); filter: brightness(1.1); box-shadow: 0 15px 30px var(--accent-glow); }
.btn-outline { background: transparent; border: 2px solid var(--border-strong); color: var(--text-main); }
.btn-outline:hover { border-color: var(--accent); background: var(--panel); color: var(--accent); transform: translateY(-3px); }

.footer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border); display: flex; justify-content: space-between; color: var(--text-muted); font-size: 0.95rem; font-weight: 600; gap: 1rem; flex-wrap: wrap; }
.actions { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; }

@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.3); } }
@keyframes float { 0% { transform: translate(0, 0) scale(1); } 50% { transform: translate(40px, -40px) scale(1.05); } 100% { transform: translate(0, 0) scale(1); } }

@media (max-width: 768px) {
  body { padding: 1rem; }
  .container { padding: 2rem; border-radius: 16px; }
  .header { flex-direction: column; align-items: flex-start; gap: 1.5rem; }
  .hero-title { font-size: 2.5rem; letter-spacing: -1px; }
  .footer { flex-direction: column; gap: 1rem; text-align: center; }
  .btn { width: 100%; justify-content: center; }
  .theme-toggle { width: 100%; justify-content: center; }
  .grid { grid-template-columns: 1fr; }
}
`;

/* ==========================================================================
 * SECTION 15: ROOT DASHBOARD (PREMIUM HTML)
 * ========================================================================== */

app.get("/", (_req, res) => {
  const uptime = Math.floor(process.uptime());
  const time = new Date().toLocaleTimeString();
  const safeAdminName = escapeHtml(ADMIN_NAME);
  const safeClientUrl = escapeHtml(CLIENT_URL);
  const safeEnv = escapeHtml(process.env.NODE_ENV || "development");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="${LOGO_URL}" type="image/jpeg" />
  <title>Oasis BIAM | Enterprise Server</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>${PREMIUM_CSS}</style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${LOGO_URL}" alt="Logo" class="logo" />
        <div class="header-text">
          <h1>Oasis BIAM</h1>
          <p>Enterprise Server</p>
        </div>
      </div>
      <button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark')">🌓 Toggle Theme</button>
    </div>
    <div class="status-pill">
      <div class="dot"></div> All Systems Operational
    </div>
    <h2 class="hero-title">Hi <span class="highlight">${safeAdminName}</span>,<br/>your server is flying.</h2>
    <p class="hero-desc">The Oasis BIAM Enterprise API is securely answering requests. Everything you need to manage the website — faculty, gallery, events, and articles — is live, responsive, and ready for action.</p>
    <div class="grid">
      <div class="card">
        <div class="card-label">Server Uptime</div>
        <div class="card-val" style="color:var(--accent)">${uptime}s</div>
      </div>
      <div class="card">
        <div class="card-label">Database</div>
        <div class="card-val" style="color:var(--success)"><div class="dot success"></div> Connected</div>
      </div>
      <div class="card">
        <div class="card-label">Environment</div>
        <div class="card-val">${safeEnv}</div>
      </div>
    </div>
    <div class="actions">
      <a href="/api/health" class="btn btn-primary">Health Check →</a>
      <a href="/api/home" class="btn btn-outline">API Index</a>
      <a href="/api/docs" class="btn btn-outline">API Docs</a>
      <a href="${safeClientUrl}/dashboard/admin" class="btn btn-outline">Admin Dashboard</a>
    </div>
    <div class="footer">
      <span>Crafted with ❤️ by Ahsan Labib Ramin</span>
      <span>Local Time: ${time}</span>
    </div>
  </div>
</body>
</html>`);
});

/* ==========================================================================
 * SECTION 16: HEALTH CHECK
 * ========================================================================== */

app.get("/api/health", catchAsync(async (req, res) => {
  let isDbConnected = false;
  try { await db.command({ ping: 1 }); isDbConnected = true; } catch { }

  const healthData = {
    status: isDbConnected ? "ok" : "error",
    db: isDbConnected ? "connected" : "unreachable",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
    platform: IS_VERCEL ? "vercel" : "node",
    version: API_VERSION,
  };

  if (req.headers.accept?.includes("text/html")) {
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>System Health | Oasis BIAM</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>${PREMIUM_CSS}</style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${LOGO_URL}" class="logo" />
        <div class="header-text">
          <h1>System Health</h1>
          <p>Diagnostics</p>
        </div>
      </div>
      <button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark')">🌓 Toggle</button>
    </div>
    <div class="status-pill">
      <div class="dot ${isDbConnected ? '' : 'danger'}"></div>
      ${isDbConnected ? 'All Systems Operational' : 'System Outage'}
    </div>
    <div class="grid">
      <div class="card"><div class="card-label">API Status</div><div class="card-val" style="color:var(--success)">Online</div></div>
      <div class="card"><div class="card-label">Database</div><div class="card-val" style="color:${isDbConnected ? 'var(--success)' : 'var(--danger)'}">${isDbConnected ? 'Connected' : 'Unreachable'}</div></div>
      <div class="card"><div class="card-label">Memory Usage</div><div class="card-val">${Math.round(healthData.memory.heapUsed / 1024 / 1024)} MB</div></div>
      <div class="card"><div class="card-label">Uptime</div><div class="card-val">${Math.floor(healthData.uptime)}s</div></div>
      <div class="card"><div class="card-label">Platform</div><div class="card-val">${healthData.platform}</div></div>
      <div class="card"><div class="card-label">API Version</div><div class="card-val">${healthData.version}</div></div>
    </div>
    <div class="actions"><a href="/" class="btn btn-primary">← Back Home</a></div>
  </div>
</body>
</html>`);
  }
  res.status(isDbConnected ? 200 : 503).json({ success: true, data: healthData });
}));

/* ==========================================================================
 * SECTION 17: HOME AGGREGATOR
 * ========================================================================== */

app.get("/api/home", catchAsync(async (req, res) => {
  const [principal, vicePrincipal, chairman, teachers, articles, notices, upcomingEvents] = await Promise.all([
    teachersCol.findOne({ role: "principal" }),
    teachersCol.findOne({ role: "vice-principal" }),
    governingCol.findOne({ isChairman: true }),
    teachersCol.find({ role: "teacher" }).limit(8).toArray(),
    articlesCol.find({}).sort({ createdAt: -1 }).limit(3).toArray(),
    noticesCol.find({}).sort({ createdAt: -1 }).limit(4).toArray(),
    eventsCol.find({}).sort({ date: 1 }).limit(3).toArray(),
  ]);

  const homeData = {
    hero: { slides: HERO_SLIDES, logo: LOGO_URL },
    principal, vicePrincipal, chairman, teachers,
    latestArticles: articles, latestNotices: notices,
    upcomingEvents,
  };

  if (req.headers.accept?.includes("text/html")) {
    const noticeCards = notices.length > 0 ? notices.map(n => `<div class="card"><div class="card-label">${escapeHtml(n.category || "General")}</div><div class="card-val" style="font-size:1.1rem">${escapeHtml(n.title)}</div></div>`).join('') : `<div class="card"><div class="card-label">No Data</div><div class="card-val">No notices yet</div></div>`;
    const articleCards = articles.length > 0 ? articles.map(a => `<div class="card"><div class="card-label">${escapeHtml(a.category || "General")}</div><div class="card-val" style="font-size:1.1rem">${escapeHtml(a.title)}</div></div>`).join('') : `<div class="card"><div class="card-label">No Data</div><div class="card-val">No articles yet</div></div>`;
    const eventCards = upcomingEvents.length > 0 ? upcomingEvents.map(e => `<div class="card"><div class="card-label">${escapeHtml(e.category || "Event")}</div><div class="card-val" style="font-size:1.1rem">${escapeHtml(e.title)}</div></div>`).join('') : `<div class="card"><div class="card-label">No Data</div><div class="card-val">No upcoming events</div></div>`;
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Index | Oasis BIAM</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>${PREMIUM_CSS}</style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${LOGO_URL}" class="logo" />
        <div class="header-text"><h1>API Index</h1><p>Home Aggregate</p></div>
      </div>
      <button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark')">🌓 Toggle</button>
    </div>
    <h2 class="section-title">Latest Notices</h2>
    <div class="grid">${noticeCards}</div>
    <h2 class="section-title">Latest Articles</h2>
    <div class="grid">${articleCards}</div>
    <h2 class="section-title">Upcoming Events</h2>
    <div class="grid">${eventCards}</div>
    <div class="actions"><a href="/" class="btn btn-primary">← Back Home</a></div>
  </div>
</body>
</html>`);
  }
  res.status(200).json({ success: true, data: homeData });
}));

/* ==========================================================================
 * SECTION 18: CONFIG & STATS
 * ========================================================================== */

app.get("/api/config/auth", catchAsync(async (_req, res) => {
  ok(res, {
    authBaseURL: BETTER_AUTH_URL,
    clientOrigin: CLIENT_URL,
    googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    emailVerificationDelivery: RESEND_API_KEY && EMAIL_FROM ? "resend" : "console",
    environment: process.env.NODE_ENV || "development",
    version: API_VERSION,
  });
}));

app.get("/api/stats", catchAsync(async (_req, res) => {
  const [articlesCount, noticesCount, teachersCount, pendingAdmissions, unreadMessages, galleryCount, eventsCount, achievementsCount, totalUsers] = await Promise.all([
    articlesCol.countDocuments(), noticesCol.countDocuments(), teachersCol.countDocuments(),
    admissionsCol.countDocuments({ status: "pending" }), contactsCol.countDocuments({ status: "new" }),
    galleryCol.countDocuments(), eventsCol.countDocuments(), achievementsCol.countDocuments(),
    usersCol.countDocuments(),
  ]);
  ok(res, {
    students: 1250, years: 21, library: 5000,
    articlesCount, noticesCount, teachersCount, pendingAdmissions, unreadMessages,
    galleryCount, eventsCount, achievementsCount, totalUsers,
  });
}));

/* ==========================================================================
 * SECTION 19: SETTINGS
 * ========================================================================== */

app.get("/api/settings", catchAsync(async (_req, res) => {
  const existing = await settingsCol.findOne({ _id: "global_settings" as any });
  ok(res, existing || { siteName: "Oasis BIAM Laboratory School", tagline: "Nurturing Excellence", address: "Barhatta Road, Netrokona", phone: "01724-483490", email: "info@oasisbiam.edu.bd", facebook: "", youtube: "" });
}));

app.put("/api/settings", requireAdmin, catchAsync(async (req, res) => {
  const { _id, ...update } = req.body;
  await settingsCol.updateOne({ _id: "global_settings" as any }, { $set: { ...update, updatedAt: new Date() } }, { upsert: true });
  await logActivity(req, "settings.update", "settings");
  msg(res, "Settings updated successfully");
}));

/* ==========================================================================
 * SECTION 20: USERS
 * ========================================================================== */

app.get("/api/users/me", requireAuth, catchAsync(async (req, res) => {
  const dbUser = await usersCol.findOne({ email: req.user!.email });
  if (!dbUser) throw new AppError("User not found", 404);
  const { password, ...safe } = dbUser as any;
  ok(res, safe);
}));

app.get("/api/users", requireAdmin, catchAsync(async (req, res) => {
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await usersCol.countDocuments();
  const users = await usersCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, users.map(u => { const { password, ...safe } = u as any; return safe; }), page, limit, total);
}));

app.post("/api/users/:id/make-admin", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  await usersCol.updateOne({ _id } as any, { $set: { role: "admin", updatedAt: new Date() } });
  await logActivity(req, "user.promote", "user", req.params.id);
  msg(res, "User promoted to admin");
}));

app.post("/api/users/:id/make-member", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const target = await usersCol.findOne({ _id } as any);
  if (!target) throw new AppError("User not found", 404);
  if ((target as any).email === req.user!.email) throw new AppError("Cannot demote yourself", 400);
  await usersCol.updateOne({ _id } as any, { $set: { role: "member", updatedAt: new Date() } });
  await logActivity(req, "user.demote", "user", req.params.id);
  msg(res, "User demoted to member");
}));

app.delete("/api/users/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const target = await usersCol.findOne({ _id } as any);
  if (!target) throw new AppError("User not found", 404);
  if ((target as any).email === req.user!.email) throw new AppError("Cannot delete yourself", 400);
  await usersCol.deleteOne({ _id } as any);
  await logActivity(req, "user.delete", "user", req.params.id);
  msg(res, "User deleted");
}));

/* ==========================================================================
 * SECTION 21: ACHIEVEMENTS (FULL CRUD)
 * ========================================================================== */

app.get("/api/achievements", catchAsync(async (req, res) => {
  const { limit, skip, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await achievementsCol.countDocuments();
  const data = await achievementsCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/achievements/:id", catchAsync(async (req, res) => {
  const doc = await achievementsCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Achievement not found", 404);
  ok(res, doc);
}));

app.post("/api/achievements", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title"]);
  const doc = {
    title: cleanString(req.body.title), description: cleanString(req.body.description),
    year: cleanString(req.body.year, new Date().getFullYear().toString()),
    image: req.body.image || null, category: cleanString(req.body.category, "General"),
    createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await achievementsCol.insertOne(doc as any);
  await logActivity(req, "achievement.create", "achievement", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/achievements/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await achievementsCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Achievement not found", 404);
  await logActivity(req, "achievement.update", "achievement", req.params.id);
  ok(res, result);
}));

app.delete("/api/achievements/:id", requireAdmin, catchAsync(async (req, res) => {
  await achievementsCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "achievement.delete", "achievement", req.params.id);
  msg(res, "Achievement deleted");
}));

/* ==========================================================================
 * SECTION 22: NOTICES (FULL CRUD)
 * ========================================================================== */

app.get("/api/notices", catchAsync(async (req, res) => {
  const { limit, skip, page } = getPagination(req.query.page as string, req.query.limit as string);
  const filter: Filter<NoticeDoc> = {};
  if (req.query.category) filter.category = req.query.category as string;
  if (req.query.featured === "true") filter.featured = true;
  const total = await noticesCol.countDocuments(filter);
  const data = await noticesCol.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/notices/:id", catchAsync(async (req, res) => {
  const doc = await noticesCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Notice not found", 404);
  ok(res, doc);
}));

app.post("/api/notices", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "content"]);
  const doc = {
    title: cleanString(req.body.title), content: cleanString(req.body.content),
    category: cleanString(req.body.category, "General"), featured: !!req.body.featured,
    authorId: req.user!.id, authorName: req.user!.name,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await noticesCol.insertOne(doc as any);
  await logActivity(req, "notice.create", "notice", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/notices/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await noticesCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Notice not found", 404);
  await logActivity(req, "notice.update", "notice", req.params.id);
  ok(res, result);
}));

app.delete("/api/notices/:id", requireAdmin, catchAsync(async (req, res) => {
  await noticesCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "notice.delete", "notice", req.params.id);
  msg(res, "Notice deleted");
}));

/* ==========================================================================
 * SECTION 23: ARTICLES (FULL CRUD)
 * ========================================================================== */

app.get("/api/articles", catchAsync(async (req, res) => {
  const { limit, skip, page } = getPagination(req.query.page as string, req.query.limit as string);
  const filter: Filter<ArticleDoc> = {};
  if (req.query.category) filter.category = req.query.category as string;
  const total = await articlesCol.countDocuments(filter);
  const data = await articlesCol.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.get("/api/articles/:id", catchAsync(async (req, res) => {
  const doc = await articlesCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Article not found", 404);
  ok(res, doc);
}));

app.get("/api/articles/slug/:slug", catchAsync(async (req, res) => {
  const doc = await articlesCol.findOne({ slug: req.params.slug } as any);
  if (!doc) throw new AppError("Article not found", 404);
  await articlesCol.updateOne({ _id: (doc as any)._id } as any, { $inc: { views: 1 } });
  ok(res, doc);
}));

app.post("/api/articles", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "content"]);
  const doc = {
    title: cleanString(req.body.title), slug: slugify(req.body.title),
    excerpt: req.body.content.substring(0, 150) + "...", content: cleanString(req.body.content),
    coverImage: req.body.coverImage || null, category: cleanString(req.body.category, "Education"),
    authorId: req.user!.id, authorName: req.user!.name, views: 0, published: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await articlesCol.insertOne(doc as any);
  await logActivity(req, "article.create", "article", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/articles/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const update: any = { ...req.body, updatedAt: new Date() }; delete update._id;
  if (update.title) update.slug = slugify(update.title);
  const result = await articlesCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Article not found", 404);
  await logActivity(req, "article.update", "article", req.params.id);
  ok(res, result);
}));

app.delete("/api/articles/:id", requireAdmin, catchAsync(async (req, res) => {
  await articlesCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "article.delete", "article", req.params.id);
  msg(res, "Article deleted");
}));

/* ==========================================================================
 * SECTION 24: TEACHERS (FULL CRUD)
 * ========================================================================== */

app.get("/api/teachers", catchAsync(async (req, res) => {
  const filter: Filter<TeacherDoc> = {};
  if (req.query.role) filter.role = req.query.role as any;
  const data = await teachersCol.find(filter).sort({ order: 1, createdAt: -1 }).toArray();
  ok(res, data);
}));

app.get("/api/teachers/:id", catchAsync(async (req, res) => {
  const doc = await teachersCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Teacher not found", 404);
  ok(res, doc);
}));

app.post("/api/teachers", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "role"]);
  const doc = {
    name: cleanString(req.body.name), role: cleanString(req.body.role, "teacher") as any,
    designation: cleanString(req.body.designation, "Teacher"), subject: cleanString(req.body.subject),
    image: req.body.image || null, bio: cleanString(req.body.bio),
    email: cleanString(req.body.email), phone: cleanString(req.body.phone),
    qualification: cleanString(req.body.qualification), experience: cleanString(req.body.experience),
    order: req.body.order || 999, createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await teachersCol.insertOne(doc as any);
  await logActivity(req, "teacher.create", "teacher", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/teachers/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await teachersCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Teacher not found", 404);
  await logActivity(req, "teacher.update", "teacher", req.params.id);
  ok(res, result);
}));

app.delete("/api/teachers/:id", requireAdmin, catchAsync(async (req, res) => {
  await teachersCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "teacher.delete", "teacher", req.params.id);
  msg(res, "Teacher deleted");
}));

/* ==========================================================================
 * SECTION 25: GOVERNING BODY (FULL CRUD)
 * ========================================================================== */

app.get("/api/governing-body", catchAsync(async (_req, res) => {
  ok(res, await governingCol.find({}).sort({ isChairman: -1, createdAt: 1 }).toArray());
}));

app.get("/api/governing-body/:id", catchAsync(async (req, res) => {
  const doc = await governingCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Member not found", 404);
  ok(res, doc);
}));

app.post("/api/governing-body", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "position"]);
  if (req.body.isChairman) await governingCol.updateMany({}, { $set: { isChairman: false } });
  const doc = {
    name: cleanString(req.body.name), position: cleanString(req.body.position),
    image: req.body.image || null, isChairman: !!req.body.isChairman,
    order: req.body.order || 999, createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await governingCol.insertOne(doc as any);
  await logActivity(req, "governingBody.create", "governingBody", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/governing-body/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  if (req.body.isChairman) await governingCol.updateMany({}, { $set: { isChairman: false } });
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await governingCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Member not found", 404);
  ok(res, result);
}));

app.delete("/api/governing-body/:id", requireAdmin, catchAsync(async (req, res) => {
  await governingCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "governingBody.delete", "governingBody", req.params.id);
  msg(res, "Member removed");
}));

/* ==========================================================================
 * SECTION 26: GALLERY (FULL CRUD)
 * ========================================================================== */

app.get("/api/gallery", catchAsync(async (req, res) => {
  const { limit, skip, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await galleryCol.countDocuments();
  const data = await galleryCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

app.post("/api/gallery", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["image"]);
  const doc = {
    title: cleanString(req.body.title, "Untitled"), image: req.body.image,
    caption: cleanString(req.body.caption), category: cleanString(req.body.category, "General"),
    createdAt: new Date(),
  };
  const result = await galleryCol.insertOne(doc as any);
  await logActivity(req, "gallery.create", "gallery", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.delete("/api/gallery/:id", requireAdmin, catchAsync(async (req, res) => {
  await galleryCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "gallery.delete", "gallery", req.params.id);
  msg(res, "Image deleted");
}));

/* ==========================================================================
 * SECTION 27: EVENTS (FULL CRUD)
 * ========================================================================== */

app.get("/api/events", catchAsync(async (_req, res) => {
  ok(res, await eventsCol.find({}).sort({ date: 1 }).toArray());
}));

app.get("/api/events/:id", catchAsync(async (req, res) => {
  const doc = await eventsCol.findOne({ _id: parseId(req.params.id) } as any);
  if (!doc) throw new AppError("Event not found", 404);
  ok(res, doc);
}));

app.post("/api/events", requireAdmin, catchAsync(async (req, res) => {
  validateRequired(req.body, ["title", "date"]);
  const doc = {
    title: cleanString(req.body.title), date: cleanString(req.body.date),
    time: cleanString(req.body.time), location: cleanString(req.body.location),
    description: cleanString(req.body.description), image: req.body.image || null,
    category: cleanString(req.body.category, "General"), createdAt: new Date(), updatedAt: new Date(),
  };
  const result = await eventsCol.insertOne(doc as any);
  await logActivity(req, "event.create", "event", result.insertedId.toString());
  ok(res, { _id: result.insertedId, ...doc }, 201);
}));

app.patch("/api/events/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const update = { ...req.body, updatedAt: new Date() }; delete update._id;
  const result = await eventsCol.findOneAndUpdate({ _id } as any, { $set: update }, { returnDocument: "after" });
  if (!result) throw new AppError("Event not found", 404);
  await logActivity(req, "event.update", "event", req.params.id);
  ok(res, result);
}));

app.delete("/api/events/:id", requireAdmin, catchAsync(async (req, res) => {
  await eventsCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "event.delete", "event", req.params.id);
  msg(res, "Event deleted");
}));

/* ==========================================================================
 * SECTION 28: CONTACTS (FULL CRUD)
 * ========================================================================== */

app.post("/api/contacts", catchAsync(async (req, res) => {
  validateRequired(req.body, ["name", "email", "message"]);
  const doc = {
    name: cleanString(req.body.name), email: cleanString(req.body.email),
    phone: cleanString(req.body.phone), subject: cleanString(req.body.subject),
    message: sanitizeInput(cleanString(req.body.message)), status: "new" as const,
    createdAt: new Date(), updatedAt: new Date(),
  };
  await contactsCol.insertOne(doc as any);
  await createNotification("New Contact Message", `${doc.name} sent a message.`);
  msg(res, "Message sent successfully", 201);
}));

app.get("/api/contacts", requireAdmin, catchAsync(async (req, res) => {
  const { skip, limit } = getPagination(req.query.page as string, req.query.limit as string);
  const data = await contactsCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  ok(res, data);
}));

app.patch("/api/contacts/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  const result = await contactsCol.updateOne({ _id } as any, { $set: { status: req.body.status, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new AppError("Message not found", 404);
  msg(res, "Status updated");
}));

app.delete("/api/contacts/:id", requireAdmin, catchAsync(async (req, res) => {
  await contactsCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "contact.delete", "contact", req.params.id);
  msg(res, "Message deleted");
}));

/* ==========================================================================
 * SECTION 29: ADMISSIONS (FULL CRUD)
 * ========================================================================== */

app.post("/api/admissions", catchAsync(async (req, res) => {
  validateRequired(req.body, ["studentName", "fatherName", "motherName", "classApplyingFor", "phone"]);
  const doc = {
    studentName: cleanString(req.body.studentName), fatherName: cleanString(req.body.fatherName),
    motherName: cleanString(req.body.motherName), birthDate: cleanString(req.body.birthDate),
    bloodGroup: cleanString(req.body.bloodGroup), classApplyingFor: cleanString(req.body.classApplyingFor),
    previousClass: cleanString(req.body.previousClass), phone: cleanString(req.body.phone),
    email: cleanString(req.body.email), currentAddress: cleanString(req.body.currentAddress),
    permanentAddress: cleanString(req.body.permanentAddress), status: "pending" as const,
    createdAt: new Date(), updatedAt: new Date(),
  };
  await admissionsCol.insertOne(doc as any);
  await createNotification("New Admission", `${doc.studentName} applied for ${doc.classApplyingFor}.`);
  msg(res, "Application submitted successfully", 201);
}));

app.get("/api/admissions", requireAdmin, catchAsync(async (req, res) => {
  const filter: Filter<AdmissionDoc> = {};
  if (req.query.status) filter.status = req.query.status as any;
  ok(res, await admissionsCol.find(filter).sort({ createdAt: -1 }).toArray());
}));

app.patch("/api/admissions/:id", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  if (!["pending", "approved", "rejected"].includes(req.body.status)) throw new AppError("Invalid status", 400);
  const result = await admissionsCol.updateOne({ _id } as any, { $set: { status: req.body.status, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new AppError("Application not found", 404);
  await logActivity(req, "admission.update", "admission", req.params.id, { status: req.body.status });
  msg(res, `Application ${req.body.status}`);
}));

app.delete("/api/admissions/:id", requireAdmin, catchAsync(async (req, res) => {
  await admissionsCol.deleteOne({ _id: parseId(req.params.id) } as any);
  await logActivity(req, "admission.delete", "admission", req.params.id);
  msg(res, "Application deleted");
}));

/* ==========================================================================
 * SECTION 30: NOTIFICATIONS
 * ========================================================================== */

app.get("/api/notifications", requireAdmin, catchAsync(async (req, res) => {
  const { skip, limit } = getPagination(req.query.page as string, req.query.limit as string);
  ok(res, await notificationsCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray());
}));

app.post("/api/notifications/:id/read", requireAdmin, catchAsync(async (req, res) => {
  const _id = parseId(req.params.id);
  await notificationsCol.updateOne({ _id } as any, { $set: { read: true, readAt: new Date() } });
  msg(res, "Notification marked as read");
}));

app.delete("/api/notifications/:id", requireAdmin, catchAsync(async (req, res) => {
  await notificationsCol.deleteOne({ _id: parseId(req.params.id) } as any);
  msg(res, "Notification deleted");
}));

/* ==========================================================================
 * SECTION 31: ACTIVITY LOG
 * ========================================================================== */

app.get("/api/activity", requireAdmin, catchAsync(async (req, res) => {
  const { skip, limit, page } = getPagination(req.query.page as string, req.query.limit as string);
  const total = await activityCol.countDocuments();
  const data = await activityCol.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
  paginated(res, data, page, limit, total);
}));

/* ==========================================================================
 * SECTION 32: ADVANCED SEARCH
 * ========================================================================== */

app.get("/api/search", catchAsync(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return ok(res, { teachers: [], articles: [], notices: [], events: [] });
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const [teachers, articles, notices, events] = await Promise.all([
    teachersCol.find({ $or: [{ name: regex }, { subject: regex }, { bio: regex }] }).limit(5).toArray(),
    articlesCol.find({ $or: [{ title: regex }, { content: regex }, { category: regex }] }).limit(5).toArray(),
    noticesCol.find({ $or: [{ title: regex }, { content: regex }, { category: regex }] }).limit(5).toArray(),
    eventsCol.find({ $or: [{ title: regex }, { description: regex }, { location: regex }] }).limit(5).toArray(),
  ]);
  ok(res, { teachers, articles, notices, events });
}));

/* ==========================================================================
 * SECTION 33: BACKUP / EXPORT
 * ========================================================================== */

const EXPORTABLE_COLLECTIONS = ["notices", "articles", "teachers", "governingBody", "gallery", "events", "achievements", "admissions", "contacts"];

app.get("/api/export/:collection", requireAdmin, catchAsync(async (req, res) => {
  const collectionName = req.params.collection;
  if (!EXPORTABLE_COLLECTIONS.includes(collectionName)) throw new AppError(`Collection not exportable: ${collectionName}`, 400);
  const data = await db.collection(collectionName).find({}).toArray();
  res.setHeader("Content-Disposition", `attachment; filename="${collectionName}-export.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(data);
}));

/* ==========================================================================
 * SECTION 34: UPLOAD (IMGBB)
 * ========================================================================== */

app.post("/api/upload", requireAdmin, upload.single("image"), catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No image file provided. Use field 'image'.", 400);
  if (!IMGBB_API_KEY) throw new AppError("Image upload is not configured on server.", 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));
    const endpoint = new URL("https://api.imgbb.com/1/upload");
    endpoint.searchParams.set("key", IMGBB_API_KEY);

    const upstreamResponse = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
    const payload: any = await upstreamResponse.json().catch(() => null);

    if (!upstreamResponse.ok || !payload?.success || !payload.data?.url) {
      throw new AppError(payload?.error?.message || `ImgBB returned HTTP ${upstreamResponse.status}`, 502);
    }
    ok(res, { url: payload.data.url, displayUrl: payload.data.display_url || payload.data.url, deleteUrl: payload.data.delete_url || null });
  } finally {
    clearTimeout(timeout);
  }
}));

/* ==========================================================================
 * SECTION 35: API DOCS PAGE
 * ========================================================================== */

app.get("/api/docs", (_req, res) => {
  const endpoints = [
    { method: "GET", path: "/api/health", desc: "System health and diagnostics" },
    { method: "GET", path: "/api/home", desc: "Homepage aggregate data" },
    { method: "GET", path: "/api/stats", desc: "Platform statistics" },
    { method: "GET", path: "/api/settings", desc: "Global site settings" },
    { method: "PUT", path: "/api/settings", desc: "Update site settings (admin)" },
    { method: "GET", path: "/api/users/me", desc: "Current user profile" },
    { method: "GET", path: "/api/users", desc: "List all users (admin)" },
    { method: "GET", path: "/api/notices", desc: "List notices" },
    { method: "POST", path: "/api/notices", desc: "Create notice (admin)" },
    { method: "GET", path: "/api/articles", desc: "List articles" },
    { method: "GET", path: "/api/articles/slug/:slug", desc: "Get article by slug" },
    { method: "POST", path: "/api/articles", desc: "Create article (admin)" },
    { method: "GET", path: "/api/teachers", desc: "List faculty" },
    { method: "POST", path: "/api/teachers", desc: "Add faculty (admin)" },
    { method: "GET", path: "/api/governing-body", desc: "List governing body" },
    { method: "GET", path: "/api/gallery", desc: "List gallery images" },
    { method: "GET", path: "/api/events", desc: "List upcoming events" },
    { method: "GET", path: "/api/achievements", desc: "List achievements" },
    { method: "POST", path: "/api/contacts", desc: "Submit contact message" },
    { method: "POST", path: "/api/admissions", desc: "Submit admission application" },
    { method: "GET", path: "/api/search?q=query", desc: "Search across all content" },
    { method: "GET", path: "/api/export/:collection", desc: "Export data as JSON (admin)" },
    { method: "POST", path: "/api/upload", desc: "Upload image to ImgBB (admin)" },
  ];

  const rows = endpoints.map(e => `<div class="list-item"><span class="badge ${e.method === "GET" ? "badge-success" : e.method === "POST" ? "badge-info" : e.method === "PUT" ? "badge-warning" : "badge-danger"}">${e.method}</span><div class="list-content"><div class="list-title" style="font-family: var(--mono); font-size: 0.9rem;">${escapeHtml(e.path)}</div><div class="list-desc">${escapeHtml(e.desc)}</div></div></div>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Documentation | Oasis BIAM</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>${PREMIUM_CSS}</style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${LOGO_URL}" class="logo" />
        <div class="header-text"><h1>API Documentation</h1><p>Oasis BIAM Enterprise · v${API_VERSION}</p></div>
      </div>
      <button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark')">🌓 Toggle</button>
    </div>
    <div class="status-pill"><div class="dot"></div> ${endpoints.length} endpoints available</div>
    <h2 class="section-title">REST API Endpoints</h2>
    <div class="list">${rows}</div>
    <div class="actions"><a href="/" class="btn btn-primary">← Back Home</a><a href="/api/health" class="btn btn-outline">Health Check</a></div>
    <div class="footer">
      <span>© ${new Date().getFullYear()} Oasis BIAM Laboratory School</span>
      <span>Powered by Node.js + MongoDB</span>
    </div>
  </div>
</body>
</html>`);
});

/* ==========================================================================
 * SECTION 36: GLOBAL ERROR HANDLING
 * ========================================================================== */

app.use((req, res, next) => next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404)));

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (req.headers.accept?.includes("text/html") && !req.path.startsWith("/api")) {
    const statusCode = err.statusCode;
    const message = err.isOperational ? err.message : "Something went wrong on our end.";
    const title = statusCode === 404 ? "Page Not Found" : statusCode === 500 ? "Server Error" : "Error";
    return res.status(statusCode).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${title} | Oasis BIAM</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" /><style>${PREMIUM_CSS}</style></head><body><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="container"><div class="header"><div class="header-left"><img src="${LOGO_URL}" class="logo" /><div class="header-text"><h1>${title}</h1><p>Error ${statusCode}</p></div></div><button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark'); document.body.classList.toggle('dark')">🌓 Toggle</button></div><h2 class="hero-title"><span class="highlight">${statusCode}</span></h2><p class="hero-desc">${escapeHtml(message)}</p><div class="actions"><a href="/" class="btn btn-primary">← Back to Home</a></div></div></body></html>`);
  }

  if (IS_PRODUCTION) {
    if (err.isOperational) res.status(err.statusCode).json({ success: false, message: err.message, requestId: req.requestId });
    else { console.error("🔥 UNHANDLED ERROR:", err); res.status(500).json({ success: false, message: "Something went wrong on our end.", requestId: req.requestId }); }
  } else {
    console.error("🔥 DEV ERROR:", err);
    res.status(err.statusCode).json({ success: false, message: err.message, stack: err.stack, requestId: req.requestId });
  }
});

/* ==========================================================================
 * SECTION 37: SERVER STARTUP
 * ========================================================================== */

async function startServer() {
  console.log("──────────────────────────────────────────────");
  console.log("🚀  OASIS BIAM SAAS BACKEND STARTING...");
  console.log("──────────────────────────────────────────────");

  // Note: No seeding! The DB starts empty.
  
  const server = app.listen(PORT, () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
    console.log(`✅ Client URL:    ${CLIENT_URL}`);
    console.log(`✅ Environment:   ${process.env.NODE_ENV || "development"}`);
    console.log(`✅ Platform:      ${IS_VERCEL ? "Vercel Serverless" : "Node.js"}`);
    console.log(`✅ API Version:   ${API_VERSION}`);
    console.log("──────────────────────────────────────────────");
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received. Closing gracefully...`);
    server.close(() => mongoClient.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

/* ==========================================================================
 * SECTION 38: VERCEL EXPORT
 * ========================================================================== */

if (IS_VERCEL) {
  module.exports = app;
  console.log("✅ Running on Vercel - exporting Express app for serverless");
} else {
  startServer().catch((error) => {
    console.error("❌ Fatal Startup Error:", error);
    process.exit(1);
  });
}