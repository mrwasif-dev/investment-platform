require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory if not exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ============ MULTER CONFIG ============
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ============ TELEGRAM BOT SETUP ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// Only initialize bot if token exists
let bot = null;
if (BOT_TOKEN && BOT_TOKEN !== 'your_bot_token_here') {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Telegram Bot started');
}

// ============ MONGODB MODELS ============
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  whatsapp: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  activePlan: {
    planId: Number,
    name: String,
    amount: Number,
    dailyProfit: Number,
    startDate: Date,
    endDate: Date,
    profitDays: { type: Number, default: 0 }
  },
  totalInvested: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  username: String,
  type: { type: String, enum: ['deposit', 'withdraw', 'profit', 'referral'] },
  amount: Number,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  accountType: String,
  accountNumber: String,
  accountTitle: String,
  screenshot: String,
  txId: String,
  planId: Number,
  createdAt: { type: Date, default: Date.now }
});

const planSchema = new mongoose.Schema({
  planId: { type: Number, unique: true },
  name: String,
  amount: Number,
  dailyProfit: { type: Number, default: 11 },
  duration: { type: Number, default: 60 },
  isActive: { type: Boolean, default: true }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const faqSchema = new mongoose.Schema({
  question: String,
  answer: String,
  order: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// ============ TELEGRAM BOT COMMANDS ============
if (bot) {
  bot.onText(/\/start|\/admin/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) {
      return bot.sendMessage(chatId, '⛔ Unauthorized');
    }

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Dashboard Stats', callback_data: 'admin_stats' }],
          [{ text: '💰 Pending Deposits', callback_data: 'pending_deps' }],
          [{ text: '💸 Pending Withdrawals', callback_data: 'pending_wds' }],
          [{ text: '👥 Users List', callback_data: 'users_list' }],
          [{ text: '📋 View Plans', callback_data: 'view_plans' }]
        ]
      }
    };

    bot.sendMessage(chatId, '🔐 *Admin Panel*\n\nWelcome! Choose an option:', {
      parse_mode: 'Markdown',
      ...keyboard
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    if (chatId !== ADMIN_ID) return bot.answerCallbackQuery(query.id);

    const action = query.data;
    await bot.answerCallbackQuery(query.id);

    try {
      if (action === 'admin_stats') {
        const users = await User.countDocuments();
        const activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true } });
        const pendingDeps = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
        const pendingWds = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });

        const totalDep = await Transaction.aggregate([
          { $match: { type: 'deposit', status: 'approved' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const msg = `📊 *Dashboard*\n\n` +
          `👤 Users: ${users}\n` +
          `✅ Active Plans: ${activePlans}\n` +
          `💰 Pending Deposits: ${pendingDeps}\n` +
          `💸 Pending Withdrawals: ${pendingWds}\n` +
          `🏦 Total Deposits: PKR ${totalDep[0]?.total || 0}`;

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }

      if (action === 'pending_deps') {
        const deps = await Transaction.find({ type: 'deposit', status: 'pending' }).limit(10);

        if (deps.length === 0) {
          return bot.sendMessage(chatId, '✅ No pending deposits');
        }

        for (const dep of deps) {
          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `appdep_${dep._id}` },
                { text: '❌ Reject', callback_data: `rejdep_${dep._id}` }
              ]]
            }
          };

          const msg = `💰 *Pending Deposit*\n` +
            `User: ${dep.username}\n` +
            `Amount: PKR ${dep.amount}\n` +
            `TxID: ${dep.txId}\n` +
            `Date: ${new Date(dep.createdAt).toLocaleDateString()}`;

          if (dep.screenshot) {
            try {
              const photoPath = path.join(__dirname, dep.screenshot);
              if (fs.existsSync(photoPath)) {
                await bot.sendPhoto(chatId, photoPath, { caption: msg, parse_mode: 'Markdown', ...keyboard });
              } else {
                await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
              }
            } catch (e) {
              await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
            }
          } else {
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
          }
        }
      }

      if (action === 'pending_wds') {
        const wds = await Transaction.find({ type: 'withdraw', status: 'pending' }).limit(10);

        if (wds.length === 0) {
          return bot.sendMessage(chatId, '✅ No pending withdrawals');
        }

        for (const wd of wds) {
          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `appwd_${wd._id}` },
                { text: '❌ Reject', callback_data: `rejwd_${wd._id}` }
              ]]
            }
          };

          const msg = `💸 *Pending Withdrawal*\n` +
            `User: ${wd.username}\n` +
            `Amount: PKR ${wd.amount}\n` +
            `Type: ${wd.accountType}\n` +
            `Account: ${wd.accountNumber}\n` +
            `Title: ${wd.accountTitle}`;

          bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
        }
      }

      if (action === 'users_list') {
        const users = await User.find().limit(20).sort({ createdAt: -1 });
        let msg = '👥 *All Users*\n\n';
        users.forEach((u, i) => {
          msg += `${i + 1}. ${u.username} | ${u.status} | PKR ${u.totalInvested}\n`;
        });
        msg += `\nTotal: ${await User.countDocuments()}`;
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }

      if (action === 'view_plans') {
        const plans = await Plan.find().sort({ planId: 1 });
        let msg = '📋 *Plans*\n\n';
        plans.forEach(p => {
          msg += `Plan ${p.planId}: ${p.name}\n`;
          msg += `Amount: PKR ${p.amount}\n`;
          msg += `Daily: ${p.dailyProfit}% | ${p.duration} Days\n\n`;
        });
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }

      // Approve/Reject Deposit
      if (action.startsWith('appdep_') || action.startsWith('rejdep_')) {
        const tid = action.split('_')[1];
        const status = action.startsWith('appdep_') ? 'approved' : 'rejected';
        const transaction = await Transaction.findById(tid);

        if (!transaction) {
          return bot.sendMessage(chatId, '❌ Transaction not found');
        }

        transaction.status = status;
        await transaction.save();

        if (status === 'approved') {
          const user = await User.findOne({ username: transaction.username });
          const plan = await Plan.findOne({ planId: transaction.planId });

          if (user && plan) {
            user.activePlan = {
              planId: plan.planId,
              name: plan.name,
              amount: plan.amount,
              dailyProfit: plan.amount * (plan.dailyProfit / 100),
              startDate: new Date(),
              endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
              profitDays: 0
            };
            user.totalInvested += plan.amount;

            const firstProfit = plan.amount * (plan.dailyProfit / 100);
            user.balance += firstProfit;
            user.totalEarned += firstProfit;
            user.activePlan.profitDays += 1;
            await user.save();

            await new Transaction({
              userId: user._id,
              username: user.username,
              type: 'profit',
              amount: firstProfit,
              status: 'approved'
            }).save();

            // Referral Bonus
            if (user.referredBy) {
              const referrer = await User.findOne({ referralCode: user.referredBy });
              if (referrer) {
                const bonusSetting = await Setting.findOne({ key: 'referralBonus' });
                const bonus = plan.amount * ((bonusSetting?.value || 11) / 100);
                referrer.balance += bonus;
                referrer.referralEarnings += bonus;
                await referrer.save();

                await new Transaction({
                  userId: referrer._id,
                  username: referrer.username,
                  type: 'referral',
                  amount: bonus,
                  status: 'approved'
                }).save();
              }
            }
          }
        }

        bot.sendMessage(chatId, `✅ Deposit ${status}!\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
      }

      // Approve/Reject Withdrawal
      if (action.startsWith('appwd_') || action.startsWith('rejwd_')) {
        const tid = action.split('_')[1];
        const status = action.startsWith('appwd_') ? 'approved' : 'rejected';
        const transaction = await Transaction.findById(tid);

        if (!transaction) {
          return bot.sendMessage(chatId, '❌ Transaction not found');
        }

        transaction.status = status;
        await transaction.save();

        if (status === 'approved') {
          const user = await User.findOne({ username: transaction.username });
          if (user) {
            user.balance -= transaction.amount;
            await user.save();
          }
        }

        bot.sendMessage(chatId, `✅ Withdrawal ${status}!\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
      }
    } catch (err) {
      console.error('Bot error:', err.message);
      bot.sendMessage(chatId, '❌ Error: ' + err.message);
    }
  });
}

// ============ AUTH MIDDLEWARE ============
function authMiddleware(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ NOTIFICATION HELPER ============
async function notifyAdmin(message) {
  if (bot && ADMIN_ID) {
    try {
      await bot.sendMessage(ADMIN_ID, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  }
}

// ============ API ROUTES ============

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { username, whatsapp, password, referralCode } = req.body;

    if (!username || !whatsapp || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    const user = new User({
      username,
      whatsapp,
      password: hashedPassword,
      referralCode: newReferralCode,
      referredBy: referralCode || null
    });

    await user.save();

    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        await notifyAdmin(`🔗 <b>New Referral!</b>\n${username} joined via ${referrer.username}'s link`);
      }
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      username: user.username,
      referralCode: newReferralCode
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Account is blocked. Contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      username: user.username,
      balance: user.balance
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Get Dashboard
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayProfit = await Transaction.aggregate([
      { 
        $match: { 
          userId: user._id, 
          type: 'profit', 
          status: 'approved',
          createdAt: { $gte: today }
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const referrals = await User.countDocuments({ referredBy: user.referralCode });

    res.json({
      username: user.username,
      balance: user.balance || 0,
      activePlan: user.activePlan || null,
      totalInvested: user.totalInvested || 0,
      totalEarned: user.totalEarned || 0,
      referralEarnings: user.referralEarnings || 0,
      referralCount: referrals,
      referralCode: user.referralCode,
      todayProfit: todayProfit[0]?.total || 0
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ error: 'Error loading dashboard' });
  }
});

// Get Plans
app.get('/api/plans', authMiddleware, async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ planId: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Error loading plans' });
  }
});

// Get Deposit Accounts
app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  try {
    const epNum = await Setting.findOne({ key: 'easypaisaNumber' });
    const epTitle = await Setting.findOne({ key: 'easypaisaTitle' });
    const jcNum = await Setting.findOne({ key: 'jazzcashNumber' });
    const jcTitle = await Setting.findOne({ key: 'jazzcashTitle' });

    res.json({
      easypaisa: {
        number: epNum?.value || '03000000000',
        title: epTitle?.value || 'Account Title'
      },
      jazzcash: {
        number: jcNum?.value || '03000000000',
        title: jcTitle?.value || 'Account Title'
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error loading accounts' });
  }
});

// Submit Deposit
app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;

    if (!planId || !accountType || !txId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Screenshot is required' });
    }

    const plan = await Plan.findOne({ planId: parseInt(planId) });
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const user = await User.findById(req.userId);

    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'deposit',
      amount: plan.amount,
      accountType,
      screenshot: req.file.path,
      txId,
      planId: plan.planId,
      status: 'pending'
    });

    await transaction.save();

    await notifyAdmin(
      `💰 <b>New Deposit Pending</b>\n\n` +
      `👤 User: ${user.username}\n` +
      `📋 Plan: ${plan.name}\n` +
      `💵 Amount: PKR ${plan.amount}\n` +
      `🔢 TxID: ${txId}\n` +
      `🏦 Method: ${accountType}\n` +
      `📅 ${new Date().toLocaleString()}`
    );

    res.json({ 
      message: 'Deposit submitted successfully! Waiting for approval.',
      transactionId: transaction._id 
    });
  } catch (err) {
    console.error('Deposit error:', err.message);
    res.status(500).json({ error: 'Deposit failed: ' + err.message });
  }
});

// Submit Withdrawal
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;

    if (!accountType || !accountNumber || !accountTitle || !amount) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const user = await User.findById(req.userId);

    if (!user.activePlan || !user.activePlan.planId) {
      return res.status(400).json({ error: 'No active plan found. Please invest first.' });
    }

    const minWithdraw = await Setting.findOne({ key: 'minWithdraw' });
    const maxWithdraw = await Setting.findOne({ key: 'maxWithdraw' });
    const maxDaily = await Setting.findOne({ key: 'maxDailyWithdraw' });

    if (withdrawAmount < (minWithdraw?.value || 30)) {
      return res.status(400).json({ error: `Minimum withdrawal is PKR ${minWithdraw?.value || 30}` });
    }

    if (withdrawAmount > (maxWithdraw?.value || 500000)) {
      return res.status(400).json({ error: `Maximum withdrawal is PKR ${maxWithdraw?.value || 500000}` });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyTotal = await Transaction.aggregate([
      { 
        $match: { 
          userId: user._id, 
          type: 'withdraw', 
          status: { $ne: 'rejected' },
          createdAt: { $gte: today } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const dailyLimit = maxDaily?.value || 100000;
    if (dailyTotal.length > 0 && (dailyTotal[0].total + withdrawAmount) > dailyLimit) {
      return res.status(400).json({ error: `Daily withdrawal limit of PKR ${dailyLimit} exceeded` });
    }

    if (user.balance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'withdraw',
      amount: withdrawAmount,
      accountType,
      accountNumber,
      accountTitle,
      status: 'pending'
    });

    await transaction.save();

    await notifyAdmin(
      `💸 <b>New Withdrawal Request</b>\n\n` +
      `👤 User: ${user.username}\n` +
      `💵 Amount: PKR ${withdrawAmount}\n` +
      `🏦 Method: ${accountType}\n` +
      `🔢 Account: ${accountNumber}\n` +
      `📛 Title: ${accountTitle}\n` +
      `📅 ${new Date().toLocaleString()}`
    );

    res.json({ message: 'Withdrawal request submitted! Waiting for approval.' });
  } catch (err) {
    console.error('Withdrawal error:', err.message);
    res.status(500).json({ error: 'Withdrawal failed: ' + err.message });
  }
});

// Get Transactions
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Error loading transactions' });
  }
});

// Get Deposits
app.get('/api/deposits', authMiddleware, async (req, res) => {
  try {
    const deposits = await Transaction.find({ 
      userId: req.userId, 
      type: 'deposit' 
    }).sort({ createdAt: -1 }).limit(20);
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ error: 'Error loading deposits' });
  }
});

// Get Withdrawals
app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ 
      userId: req.userId, 
      type: 'withdraw' 
    }).sort({ createdAt: -1 }).limit(20);
    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ error: 'Error loading withdrawals' });
  }
});

// Get Team
app.get('/api/team', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const team = await User.find({ referredBy: user.referralCode })
      .select('username totalInvested totalEarned createdAt')
      .sort({ createdAt: -1 });

    res.json({
      teamCount: team.length,
      team: team
    });
  } catch (err) {
    res.status(500).json({ error: 'Error loading team' });
  }
});

// Get Leaderboard
app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const topInvestors = await User.find({ status: 'active' })
      .sort({ totalInvested: -1 })
      .limit(10)
      .select('username totalInvested');

    const topReferrers = await User.aggregate([
      { $match: { status: 'active' } },
      { 
        $lookup: { 
          from: 'users', 
          localField: 'referralCode', 
          foreignField: 'referredBy', 
          as: 'refs' 
        } 
      },
      { $project: { username: 1, count: { $size: '$refs' } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({ topInvestors, topReferrers });
  } catch (err) {
    res.status(500).json({ error: 'Error loading leaderboard' });
  }
});

// Get FAQs
app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await FAQ.find().sort({ order: 1 });
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ error: 'Error loading FAQs' });
  }
});

// ============ DAILY PROFIT CRON JOB ============
cron.schedule('0 0 * * *', async () => {
  console.log('🕛 Running daily profit distribution...');
  try {
    const users = await User.find({
      'activePlan.planId': { $exists: true },
      'activePlan.endDate': { $gte: new Date() },
      'activePlan.profitDays': { $lt: 60 },
      status: 'active'
    });

    let count = 0;
    for (const user of users) {
      if (user.activePlan && user.activePlan.profitDays < 60) {
        const profit = user.activePlan.dailyProfit;
        user.balance += profit;
        user.totalEarned += profit;
        user.activePlan.profitDays += 1;
        await user.save();

        await new Transaction({
          userId: user._id,
          username: user.username,
          type: 'profit',
          amount: profit,
          status: 'approved'
        }).save();
        
        count++;
      }
    }
    console.log(`✅ Daily profit distributed to ${count} users`);
  } catch (err) {
    console.error('❌ Profit distribution error:', err.message);
  }
});

console.log('⏰ Daily profit cron job scheduled for midnight');

// ============ INITIALIZE DATA ============
async function initializeData() {
  try {
    // Plans
    const planCount = await Plan.countDocuments();
    if (planCount === 0) {
      await Plan.insertMany([
        { planId: 1, name: 'Starter', amount: 360, dailyProfit: 11, duration: 60 },
        { planId: 2, name: 'Silver', amount: 860, dailyProfit: 11, duration: 60 },
        { planId: 3, name: 'Gold', amount: 1460, dailyProfit: 11, duration: 60 },
        { planId: 4, name: 'Platinum', amount: 2660, dailyProfit: 11, duration: 60 },
        { planId: 5, name: 'Diamond', amount: 4260, dailyProfit: 11, duration: 60 },
        { planId: 6, name: 'Ruby', amount: 6060, dailyProfit: 11, duration: 60 },
        { planId: 7, name: 'Emerald', amount: 9060, dailyProfit: 11, duration: 60 },
        { planId: 8, name: 'Sapphire', amount: 14060, dailyProfit: 11, duration: 60 },
        { planId: 9, name: 'Titanium', amount: 21060, dailyProfit: 11, duration: 60 },
        { planId: 10, name: 'Master', amount: 30000, dailyProfit: 11, duration: 60 },
        { planId: 11, name: 'Custom', amount: 50000, dailyProfit: 11, duration: 60 }
      ]);
      console.log('✅ Default plans created');
    }

    // Settings
    const settingsCount = await Setting.countDocuments();
    if (settingsCount === 0) {
      await Setting.insertMany([
        { key: 'referralBonus', value: 11 },
        { key: 'minWithdraw', value: 30 },
        { key: 'maxWithdraw', value: 500000 },
        { key: 'maxDailyWithdraw', value: 100000 },
        { key: 'easypaisaNumber', value: '03001234567' },
        { key: 'easypaisaTitle', value: 'Muhammad Ali' },
        { key: 'jazzcashNumber', value: '03009876543' },
        { key: 'jazzcashTitle', value: 'Muhammad Ali' }
      ]);
      console.log('✅ Default settings created');
    }

    // FAQs
    const faqCount = await FAQ.countDocuments();
    if (faqCount === 0) {
      await FAQ.insertMany([
        { question: 'How to invest?', answer: 'Select a plan, send payment to given account, upload screenshot with Transaction ID.', order: 1 },
        { question: 'When do I get profit?', answer: 'You get first profit immediately after deposit approval. Then daily at 12:00 AM.', order: 2 },
        { question: 'Minimum withdrawal?', answer: 'Minimum withdrawal is PKR 30.', order: 3 },
        { question: 'How referral works?', answer: 'Share your link. When someone joins and invests, you get 11% bonus instantly.', order: 4 }
      ]);
      console.log('✅ Default FAQs created');
    }
  } catch (err) {
    console.error('❌ Data initialization error:', err.message);
  }
}

// ============ START SERVER ============
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/investment_db';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected successfully');
    await initializeData();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Access: http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});
