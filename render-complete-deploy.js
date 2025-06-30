/*
===========================================
R&E HIVE COMPLETE BUSINESS PLATFORM
===========================================
Full-stack deployment with React frontend and Express backend
Includes: User dashboard, commission tracking, payment processing,
gift codes, referral network, admin controls, subscription management
===========================================
*/

import express from "express";
import { createServer } from "http";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { pgTable, serial, text, integer, timestamp, decimal, boolean, uuid as pgUuid } from "drizzle-orm/pg-core";
import { eq, and, desc, asc, sum, count, sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import session from "express-session";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database Schema
const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  passive_commission_rate: decimal("passive_commission_rate", { precision: 5, scale: 4 }).notNull(),
  direct_commission_rate: decimal("direct_commission_rate", { precision: 3, scale: 2 }).notNull(),
  description: text("description"),
  monthly_subscription_fee: decimal("monthly_subscription_fee", { precision: 10, scale: 2 }).default("0.00"),
  video_url: text("video_url"),
  created_at: timestamp("created_at").defaultNow().notNull()
});

const users = pgTable("users", {
  id: pgUuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  full_name: text("full_name").notNull(),
  phone_number: text("phone_number"),
  country: text("country"),
  package_id: integer("package_id").references(() => packages.id),
  referral_code: text("referral_code").notNull().unique(),
  kyc_status: text("kyc_status").default("pending"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  commission_balance: decimal("commission_balance", { precision: 10, scale: 2 }).default("0.00"),
  kyc_submitted_at: timestamp("kyc_submitted_at"),
  kyc_approved_at: timestamp("kyc_approved_at"),
  date_of_birth: text("date_of_birth"),
  id_document_type: text("id_document_type"),
  id_document_number: text("id_document_number"),
  stripe_customer_id: text("stripe_customer_id"),
  subscription_status: text("subscription_status").default("inactive"),
  subscription_expires_at: timestamp("subscription_expires_at"),
  last_subscription_payment: timestamp("last_subscription_payment")
});

const gift_codes = pgTable("gift_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  package_id: integer("package_id").references(() => packages.id).notNull(),
  created_by: pgUuid("created_by").references(() => users.id).notNull(),
  is_redeemed: boolean("is_redeemed").default(false),
  redeemed_by: pgUuid("redeemed_by").references(() => users.id),
  redeemed_at: timestamp("redeemed_at"),
  created_at: timestamp("created_at").defaultNow().notNull()
});

const commissions = pgTable("commissions", {
  id: serial("id").primaryKey(),
  user_id: pgUuid("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  type: text("type").notNull(),
  source_user_id: pgUuid("source_user_id").references(() => users.id),
  gift_code_id: integer("gift_code_id").references(() => gift_codes.id),
  created_at: timestamp("created_at").defaultNow().notNull()
});

const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrer_id: pgUuid("referrer_id").references(() => users.id).notNull(),
  referred_id: pgUuid("referred_id").references(() => users.id).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull()
});

const commission_withdrawals = pgTable("commission_withdrawals", {
  id: serial("id").primaryKey(),
  user_id: pgUuid("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").default("pending"),
  payment_method: text("payment_method").default("bank_transfer"),
  payment_details: text("payment_details"),
  admin_notes: text("admin_notes"),
  reference_number: text("reference_number"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
  processed_at: timestamp("processed_at")
});

const subscription_payments = pgTable("subscription_payments", {
  id: serial("id").primaryKey(),
  user_id: pgUuid("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  payment_proof_url: text("payment_proof_url"),
  status: text("status").default("pending"),
  admin_notes: text("admin_notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  processed_at: timestamp("processed_at")
});

const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  user_id: pgUuid("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").default("info"),
  is_read: boolean("is_read").default(false),
  created_at: timestamp("created_at").defaultNow().notNull()
});

const company_profits = pgTable("company_profits", {
  id: serial("id").primaryKey(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  source_type: text("source_type").notNull(),
  source_id: text("source_id").notNull(),
  commission_paid: decimal("commission_paid", { precision: 10, scale: 2 }).default("0.00"),
  is_withdrawn: boolean("is_withdrawn").default(false),
  created_at: timestamp("created_at").defaultNow().notNull()
});

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, {
  schema: {
    packages, users, gift_codes, commissions, referrals,
    commission_withdrawals, subscription_payments, notifications, company_profits
  }
});

// Express app setup
const app = express();
const server = createServer(app);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'rehive-business-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ storage: storage });

// Utility functions
function generateGiftCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Commission processing
async function processCommissions(giftCode, userId) {
  try {
    const packageData = await db.query.packages.findFirst({
      where: eq(packages.id, giftCode.package_id)
    });

    if (!packageData) return;

    const directCommission = parseFloat(packageData.price) * parseFloat(packageData.direct_commission_rate);
    
    await db.insert(commissions).values({
      user_id: giftCode.created_by,
      amount: directCommission.toString(),
      type: 'direct',
      source_user_id: userId,
      gift_code_id: giftCode.id
    });

    await db.update(users)
      .set({
        commission_balance: sql`${users.commission_balance} + ${directCommission}`
      })
      .where(eq(users.id, giftCode.created_by));

    await processPassiveCommissions(userId, giftCode, directCommission);

    await db.insert(notifications).values({
      user_id: giftCode.created_by,
      title: 'Commission Earned!',
      message: `You earned $${directCommission.toFixed(2)} from a direct referral`,
      type: 'commission'
    });

  } catch (error) {
    console.error('Error processing commissions:', error);
  }
}

async function processPassiveCommissions(startUserId, giftCode, directCommissionsPaid) {
  try {
    const packageData = await db.query.packages.findFirst({
      where: eq(packages.id, giftCode.package_id)
    });

    if (!packageData) return;

    let currentUser = await db.query.users.findFirst({
      where: eq(users.id, startUserId)
    });

    let level = 1;
    const maxLevels = 10;
    let totalPassiveCommissions = 0;

    while (currentUser && level <= maxLevels) {
      const referral = await db.query.referrals.findFirst({
        where: eq(referrals.referred_id, currentUser.id)
      });

      if (!referral) break;

      const uplineUser = await db.query.users.findFirst({
        where: eq(users.id, referral.referrer_id)
      });

      if (!uplineUser) break;

      const passiveCommission = parseFloat(packageData.price) * parseFloat(packageData.passive_commission_rate);

      await db.insert(commissions).values({
        user_id: uplineUser.id,
        amount: passiveCommission.toString(),
        type: 'passive',
        source_user_id: startUserId,
        gift_code_id: giftCode.id
      });

      await db.update(users)
        .set({
          commission_balance: sql`${users.commission_balance} + ${passiveCommission}`
        })
        .where(eq(users.id, uplineUser.id));

      await db.insert(notifications).values({
        user_id: uplineUser.id,
        title: 'Passive Commission Earned!',
        message: `You earned $${passiveCommission.toFixed(2)} from your network (Level ${level})`,
        type: 'commission'
      });

      totalPassiveCommissions += passiveCommission;
      currentUser = uplineUser;
      level++;
    }

    const totalCommissionPaid = directCommissionsPaid + totalPassiveCommissions;
    const companyProfit = parseFloat(packageData.price) - totalCommissionPaid;

    await db.insert(company_profits).values({
      amount: Math.max(0, companyProfit).toString(),
      source_type: 'gift_code',
      source_id: giftCode.id.toString(),
      commission_paid: totalCommissionPaid.toString()
    });

  } catch (error) {
    console.error('Error processing passive commissions:', error);
  }
}

// Authentication middleware
const isFounder = async (req, res, next) => {
  try {
    const userId = req.session?.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user || user.email !== 'founder@rehive.com') {
      return res.status(403).json({ error: 'Access denied - Founder only' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// API Routes
app.get('/api/users/me', async (req, res) => {
  try {
    const userId = req.session?.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: { package: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.params.id),
      with: { package: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/:id/referrals', async (req, res) => {
  try {
    const userReferrals = await db.query.referrals.findMany({
      where: eq(referrals.referrer_id, req.params.id),
      with: {
        referred: {
          with: { package: true }
        }
      },
      orderBy: desc(referrals.created_at)
    });

    res.json(userReferrals);
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/packages', async (req, res) => {
  try {
    const allPackages = await db.query.packages.findMany({
      orderBy: asc(packages.price)
    });
    res.json(allPackages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/gift-codes', async (req, res) => {
  try {
    const { packageId, userId } = req.body;
    
    if (!packageId || !userId) {
      return res.status(400).json({ error: 'Package ID and User ID are required' });
    }

    const code = generateGiftCode();
    
    const [giftCode] = await db.insert(gift_codes).values({
      code,
      package_id: packageId,
      created_by: userId
    }).returning();

    res.status(201).json(giftCode);
  } catch (error) {
    console.error('Error creating gift code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/gift-codes/:userId', async (req, res) => {
  try {
    const userGiftCodes = await db.query.gift_codes.findMany({
      where: eq(gift_codes.created_by, req.params.userId),
      with: { 
        package: true,
        redeemer: true
      },
      orderBy: desc(gift_codes.created_at)
    });

    res.json(userGiftCodes);
  } catch (error) {
    console.error('Error fetching gift codes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/redeem-gift-code', async (req, res) => {
  try {
    const { code, userId, referralCode } = req.body;

    if (!code || !userId) {
      return res.status(400).json({ error: 'Code and User ID are required' });
    }

    const giftCode = await db.query.gift_codes.findFirst({
      where: and(eq(gift_codes.code, code), eq(gift_codes.is_redeemed, false))
    });

    if (!giftCode) {
      return res.status(404).json({ error: 'Invalid or already redeemed gift code' });
    }

    if (giftCode.created_by === userId) {
      return res.status(400).json({ error: 'Cannot redeem your own gift code' });
    }

    await db.update(gift_codes)
      .set({
        is_redeemed: true,
        redeemed_by: userId,
        redeemed_at: new Date()
      })
      .where(eq(gift_codes.id, giftCode.id));

    await db.update(users)
      .set({ package_id: giftCode.package_id })
      .where(eq(users.id, userId));

    if (referralCode) {
      const referrer = await db.query.users.findFirst({
        where: eq(users.referral_code, referralCode)
      });

      if (referrer && referrer.id !== userId) {
        await db.insert(referrals).values({
          referrer_id: referrer.id,
          referred_id: userId
        });
      }
    }

    await processCommissions(giftCode, userId);

    res.json({ message: 'Gift code redeemed successfully' });
  } catch (error) {
    console.error('Error redeeming gift code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/commission-history/:userId', async (req, res) => {
  try {
    const userCommissions = await db.query.commissions.findMany({
      where: eq(commissions.user_id, req.params.userId),
      orderBy: desc(commissions.created_at),
      limit: 100
    });

    res.json(userCommissions);
  } catch (error) {
    console.error('Error fetching commission history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/commission-withdrawals', async (req, res) => {
  try {
    const { userId, amount, paymentMethod, paymentDetails } = req.body;

    if (!userId || !amount || !paymentDetails) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const withdrawalAmount = parseFloat(amount);
    const currentBalance = parseFloat(user.commission_balance);

    if (currentBalance < withdrawalAmount) {
      return res.status(400).json({ error: 'Insufficient commission balance' });
    }

    const [withdrawal] = await db.insert(commission_withdrawals).values({
      user_id: userId,
      amount: amount,
      payment_method: paymentMethod || 'bank_transfer',
      payment_details: JSON.stringify(paymentDetails)
    }).returning();

    res.status(201).json(withdrawal);
  } catch (error) {
    console.error('Error creating withdrawal request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/commission-withdrawals', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const withdrawals = await db.query.commission_withdrawals.findMany({
      where: eq(commission_withdrawals.user_id, userId),
      orderBy: desc(commission_withdrawals.created_at)
    });

    res.json(withdrawals);
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/subscription/status', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();
    const isActive = user.subscription_expires_at && new Date(user.subscription_expires_at) > now;

    res.json({
      status: isActive ? 'active' : 'expired',
      expires_at: user.subscription_expires_at,
      last_payment: user.last_subscription_payment
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/subscription/pay', upload.single('paymentProof'), async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const paymentProofUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const [payment] = await db.insert(subscription_payments).values({
      user_id: userId,
      amount: "50.00",
      payment_proof_url: paymentProofUrl
    }).returning();

    await db.insert(notifications).values({
      user_id: userId,
      title: 'Subscription Payment Submitted',
      message: 'Your subscription payment has been submitted for review',
      type: 'payment'
    });

    res.status(201).json(payment);
  } catch (error) {
    console.error('Error processing subscription payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/subscription/payments', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const payments = await db.query.subscription_payments.findMany({
      where: eq(subscription_payments.user_id, userId),
      orderBy: desc(subscription_payments.created_at)
    });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching subscription payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const userNotifications = await db.query.notifications.findMany({
      where: eq(notifications.user_id, req.params.userId),
      orderBy: desc(notifications.created_at),
      limit: 50
    });

    res.json(userNotifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    await db.update(notifications)
      .set({ is_read: true })
      .where(eq(notifications.id, parseInt(req.params.id)));

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error updating notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin/Founder routes
app.get('/api/admin/commission-withdrawals', isFounder, async (req, res) => {
  try {
    const withdrawals = await db.query.commission_withdrawals.findMany({
      with: { user: true },
      orderBy: desc(commission_withdrawals.created_at)
    });

    res.json(withdrawals);
  } catch (error) {
    console.error('Error fetching admin withdrawals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/commission-withdrawals/:id', isFounder, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const withdrawalId = parseInt(req.params.id);

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const withdrawal = await db.query.commission_withdrawals.findFirst({
      where: eq(commission_withdrawals.id, withdrawalId)
    });

    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (status === 'approved') {
      await db.update(users)
        .set({
          commission_balance: sql`${users.commission_balance} - ${withdrawal.amount}`
        })
        .where(eq(users.id, withdrawal.user_id));
    }

    await db.update(commission_withdrawals)
      .set({
        status,
        admin_notes: adminNotes,
        updated_at: new Date(),
        processed_at: new Date()
      })
      .where(eq(commission_withdrawals.id, withdrawalId));

    await db.insert(notifications).values({
      user_id: withdrawal.user_id,
      title: `Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: `Your withdrawal request for $${withdrawal.amount} has been ${status}`,
      type: 'withdrawal'
    });

    res.json({ message: `Withdrawal ${status} successfully` });
  } catch (error) {
    console.error('Error updating withdrawal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/subscription-payments', isFounder, async (req, res) => {
  try {
    const payments = await db.query.subscription_payments.findMany({
      with: { user: true },
      orderBy: desc(subscription_payments.created_at)
    });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching subscription payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/subscription-payments/:id/approve', isFounder, async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id);
    
    const payment = await db.query.subscription_payments.findFirst({
      where: eq(subscription_payments.id, paymentId)
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await db.update(subscription_payments)
      .set({
        status: 'approved',
        processed_at: new Date()
      })
      .where(eq(subscription_payments.id, paymentId));

    const newExpiryDate = new Date();
    newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);

    await db.update(users)
      .set({
        subscription_status: 'active',
        subscription_expires_at: newExpiryDate,
        last_subscription_payment: new Date()
      })
      .where(eq(users.id, payment.user_id));

    await db.insert(notifications).values({
      user_id: payment.user_id,
      title: 'Subscription Activated',
      message: 'Your subscription payment has been approved and your subscription is now active',
      type: 'subscription'
    });

    res.json({ message: 'Subscription payment approved' });
  } catch (error) {
    console.error('Error approving subscription payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/subscription-payments/:id/reject', isFounder, async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id);
    const { adminNotes } = req.body;
    
    const payment = await db.query.subscription_payments.findFirst({
      where: eq(subscription_payments.id, paymentId)
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await db.update(subscription_payments)
      .set({
        status: 'rejected',
        admin_notes: adminNotes,
        processed_at: new Date()
      })
      .where(eq(subscription_payments.id, paymentId));

    await db.insert(notifications).values({
      user_id: payment.user_id,
      title: 'Subscription Payment Rejected',
      message: `Your subscription payment has been rejected. ${adminNotes || 'Please contact support for more information.'}`,
      type: 'subscription'
    });

    res.json({ message: 'Subscription payment rejected' });
  } catch (error) {
    console.error('Error rejecting subscription payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/add-commission', isFounder, async (req, res) => {
  try {
    const { userId, amount, type, description } = req.body;

    if (!userId || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.insert(commissions).values({
      user_id: userId,
      amount: amount,
      type: type
    });

    await db.update(users)
      .set({
        commission_balance: sql`${users.commission_balance} + ${amount}`
      })
      .where(eq(users.id, userId));

    await db.insert(notifications).values({
      user_id: userId,
      title: 'Commission Added',
      message: `$${amount} ${type} commission has been added to your account. ${description || ''}`,
      type: 'commission'
    });

    res.json({ message: 'Commission added successfully' });
  } catch (error) {
    console.error('Error adding commission:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Static file serving
app.use('/uploads', express.static('./uploads'));

// React Frontend HTML
app.get('*', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>R&E Hive - Where Financial Dreams Come True</title>
        <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
        <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        </style>
    </head>
    <body>
        <div id="root"></div>
        <script type="text/babel">
            const { useState, useEffect } = React;

            function App() {
                const [user, setUser] = useState(null);
                const [packages, setPackages] = useState([]);
                const [notifications, setNotifications] = useState([]);
                const [commissionHistory, setCommissionHistory] = useState([]);
                const [giftCodes, setGiftCodes] = useState([]);
                const [activeTab, setActiveTab] = useState('dashboard');
                const [loading, setLoading] = useState(true);

                const userId = '5b5a46b1-ed50-4c2a-b387-23f4b5b9e170'; // Demo user

                useEffect(() => {
                    fetchUserData();
                    fetchPackages();
                    fetchNotifications();
                    fetchCommissionHistory();
                    fetchGiftCodes();
                }, []);

                const fetchUserData = async () => {
                    try {
                        const response = await fetch(\`/api/users/\${userId}\`);
                        const userData = await response.json();
                        setUser(userData);
                        setLoading(false);
                    } catch (error) {
                        console.error('Error fetching user data:', error);
                        setLoading(false);
                    }
                };

                const fetchPackages = async () => {
                    try {
                        const response = await fetch('/api/packages');
                        const packagesData = await response.json();
                        setPackages(packagesData);
                    } catch (error) {
                        console.error('Error fetching packages:', error);
                    }
                };

                const fetchNotifications = async () => {
                    try {
                        const response = await fetch(\`/api/notifications/\${userId}\`);
                        const notificationsData = await response.json();
                        setNotifications(notificationsData);
                    } catch (error) {
                        console.error('Error fetching notifications:', error);
                    }
                };

                const fetchCommissionHistory = async () => {
                    try {
                        const response = await fetch(\`/api/commission-history/\${userId}\`);
                        const commissionData = await response.json();
                        setCommissionHistory(commissionData);
                    } catch (error) {
                        console.error('Error fetching commission history:', error);
                    }
                };

                const fetchGiftCodes = async () => {
                    try {
                        const response = await fetch(\`/api/gift-codes/\${userId}\`);
                        const giftCodesData = await response.json();
                        setGiftCodes(giftCodesData);
                    } catch (error) {
                        console.error('Error fetching gift codes:', error);
                    }
                };

                const createGiftCode = async (packageId) => {
                    try {
                        const response = await fetch('/api/gift-codes', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                packageId: packageId,
                                userId: userId
                            })
                        });
                        
                        if (response.ok) {
                            fetchGiftCodes();
                            alert('Gift code created successfully!');
                        }
                    } catch (error) {
                        console.error('Error creating gift code:', error);
                    }
                };

                if (loading) {
                    return (
                        <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white"></div>
                        </div>
                    );
                }

                return (
                    <div className="min-h-screen bg-gray-50">
                        {/* Header */}
                        <nav className="bg-gradient-to-r from-blue-600 to-purple-700 text-white shadow-lg">
                            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                                <div className="flex justify-between items-center h-16">
                                    <div className="flex items-center">
                                        <h1 className="text-2xl font-bold">🏆 R&E Hive</h1>
                                        <span className="ml-2 text-sm opacity-75">Where Financial Dreams Come True</span>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <span className="text-sm">Welcome, {user?.full_name}</span>
                                        <div className="bg-white/20 px-3 py-1 rounded-full">
                                            <span className="text-sm font-medium">{user?.package?.name} Member</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </nav>

                        {/* Tab Navigation */}
                        <div className="bg-white border-b">
                            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                                <div className="flex space-x-8">
                                    {[
                                        { id: 'dashboard', label: 'Dashboard' },
                                        { id: 'giftcodes', label: 'Gift Codes' },
                                        { id: 'commissions', label: 'Commissions' },
                                        { id: 'notifications', label: 'Notifications' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={\`py-4 px-1 border-b-2 font-medium text-sm \${
                                                activeTab === tab.id
                                                    ? 'border-blue-500 text-blue-600'
                                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            }\`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Main Content */}
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                            {activeTab === 'dashboard' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {/* Commission Balance Card */}
                                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
                                        <h3 className="text-lg font-semibold mb-2">Commission Balance</h3>
                                        <p className="text-3xl font-bold">\${user?.commission_balance}</p>
                                        <p className="text-green-100 text-sm mt-2">Available for withdrawal</p>
                                    </div>

                                    {/* Package Info Card */}
                                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                                        <h3 className="text-lg font-semibold mb-2">Your Package</h3>
                                        <p className="text-2xl font-bold">{user?.package?.name}</p>
                                        <p className="text-blue-100 text-sm mt-2">
                                            {user?.package?.direct_commission_rate * 100}% Direct Commission
                                        </p>
                                    </div>

                                    {/* Referral Code Card */}
                                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
                                        <h3 className="text-lg font-semibold mb-2">Your Referral Code</h3>
                                        <p className="text-2xl font-bold font-mono">{user?.referral_code}</p>
                                        <p className="text-purple-100 text-sm mt-2">Share to earn commissions</p>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'giftcodes' && (
                                <div className="space-y-6">
                                    <div className="bg-white rounded-xl shadow-lg p-6">
                                        <h2 className="text-2xl font-bold mb-4">Create Gift Codes</h2>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {packages.map(pkg => (
                                                <div key={pkg.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                                                    <h3 className="font-semibold text-lg">{pkg.name}</h3>
                                                    <p className="text-gray-600 text-sm mb-2">{pkg.description}</p>
                                                    <p className="text-2xl font-bold text-green-600 mb-3">\${pkg.price}</p>
                                                    <button
                                                        onClick={() => createGiftCode(pkg.id)}
                                                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                                                    >
                                                        Create Gift Code
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-xl shadow-lg p-6">
                                        <h2 className="text-2xl font-bold mb-4">Your Gift Codes</h2>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {giftCodes.map(code => (
                                                        <tr key={code.id}>
                                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-sm font-medium text-gray-900">
                                                                {code.code}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                {code.package?.name}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap">
                                                                <span className={\`px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${
                                                                    code.is_redeemed 
                                                                        ? 'bg-green-100 text-green-800' 
                                                                        : 'bg-yellow-100 text-yellow-800'
                                                                }\`}>
                                                                    {code.is_redeemed ? 'Redeemed' : 'Active'}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                {new Date(code.created_at).toLocaleDateString()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'commissions' && (
                                <div className="bg-white rounded-xl shadow-lg p-6">
                                    <h2 className="text-2xl font-bold mb-4">Commission History</h2>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {commissionHistory.map(commission => (
                                                    <tr key={commission.id}>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                                                            \${commission.amount}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                            <span className={\`px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${
                                                                commission.type === 'direct' 
                                                                    ? 'bg-blue-100 text-blue-800' 
                                                                    : 'bg-purple-100 text-purple-800'
                                                            }\`}>
                                                                {commission.type}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                            {new Date(commission.created_at).toLocaleDateString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'notifications' && (
                                <div className="bg-white rounded-xl shadow-lg p-6">
                                    <h2 className="text-2xl font-bold mb-4">Notifications</h2>
                                    <div className="space-y-4">
                                        {notifications.map(notification => (
                                            <div key={notification.id} className={\`p-4 rounded-lg border-l-4 \${
                                                notification.type === 'commission' ? 'border-green-500 bg-green-50' :
                                                notification.type === 'payment' ? 'border-blue-500 bg-blue-50' :
                                                'border-gray-500 bg-gray-50'
                                            }\`}>
                                                <h3 className="font-semibold text-lg">{notification.title}</h3>
                                                <p className="text-gray-600">{notification.message}</p>
                                                <p className="text-sm text-gray-400 mt-2">
                                                    {new Date(notification.created_at).toLocaleString()}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            }

            ReactDOM.render(<App />, document.getElementById('root'));
        </script>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Server startup
const port = process.env.PORT || 5000;

server.listen(port, "0.0.0.0", () => {
  console.log(`🏆 R&E Hive Business Platform running on port ${port}`);
  console.log(`💰 Commission System: Active`);
  console.log(`🎁 Gift Code System: Active`);
  console.log(`💳 Payment Processing: Active`);
  console.log(`📊 Admin Dashboard: Active`);
  console.log(`🔔 Notification System: Active`);
  console.log(`🖥️ React Frontend: Integrated`);
});

export default app;