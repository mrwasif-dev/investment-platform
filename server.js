const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ============ TELEGRAM BOT SETUP ============
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// Telegram Bot Commands
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Dashboard Stats', callback_data: 'admin_dashboard' }],
        [{ text: '👥 All Users', callback_data: 'admin_users' }],
        [{ text: '💰 Pending Deposits', callback_data: 'admin_pending_deposits' }],
        [{ text: '💸 Pending Withdrawals', callback_data: 'admin_pending_withdrawals' }],
        [{ text: '📋 All Plans', callback_data: 'admin_plans' }],
        [{ text: '⚙️ Settings', callback_data: 'admin_settings' }],
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '❓ FAQ Manage', callback_data: 'admin_faq' }]
      ]
    }
  };
  
  bot.sendMessage(ADMIN_ID, '🔐 *Admin Panel*\n\nWelcome! Select an option:', {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Bot Callback Handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (chatId.toString() !== ADMIN_ID) return;

  const action = query.data;
  await bot.answerCallbackQuery(query.id);

  if (action === 'admin_dashboard') {
    try {
      const totalUsers = await User.countDocuments();
      const activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true } });
      const pendingDeposits = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
      const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
      
      const totalDeposits = await Transaction.aggregate([
        { $match: { type: 'deposit', status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      const totalWithdrawals = await Transaction.aggregate([
        { $match: { type: 'withdraw', status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      const stats = `📊 *Dashboard Statistics*\n\n` +
        `👤 Total Users: ${totalUsers}\n` +
        `✅ Active Plans: ${activePlans}\n` +
        `💰 Pending Deposits: ${pendingDeposits}\n` +
        `💸 Pending Withdrawals: ${pendingWithdrawals}\n` +
        `🏦 Total Deposits: PKR ${totalDeposits[0]?.total || 0}\n` +
        `💵 Total Withdrawals: PKR ${totalWithdrawals[0]?.total || 0}`;

      bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error loading stats');
    }
  }

  if (action === 'admin_users') {
    try {
      const users = await User.find().limit(20);
      let message = '👥 *All Users*\n\n';
      users.forEach((u, i) => {
        message += `${i + 1}. ${u.username} | ${u.totalInvested} PKR | ${u.status}\n`;
      });
      message += `\nTotal: ${await User.countDocuments()} users`;
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error loading users');
    }
  }

  if (action === 'admin_pending_deposits') {
    try {
      const deposits = await Transaction.find({ type: 'deposit', status: 'pending' }).limit(10);
      if (deposits.length === 0) {
        bot.sendMessage(chatId, '✅ No pending deposits');
        return;
      }

      for (const dep of deposits) {
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve_dep_${dep._id}` },
                { text: '❌ Reject', callback_data: `reject_dep_${dep._id}` }
              ]
            ]
          }
        };

        const message = `💰 *Pending Deposit*\n\n` +
          `👤 User: ${dep.username}\n` +
          `💵 Amount: PKR ${dep.amount}\n` +
          `🔢 TxID: ${dep.txId}\n` +
          `🏦 Type: ${dep.accountType}\n` +
          `📅 Date: ${new Date(dep.createdAt).toLocaleDateString()}`;

        if (dep.screenshot) {
          bot.sendPhoto(chatId, `${req.protocol}://${req.get('host')}/${dep.screenshot}`, {
            caption: message,
            parse_mode: 'Markdown',
            ...keyboard
          });
        } else {
          bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
        }
      }
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error loading deposits');
    }
  }

  if (action === 'admin_pending_withdrawals') {
    try {
      const withdrawals = await Transaction.find({ type: 'withdraw', status: 'pending' }).limit(10);
      if (withdrawals.length === 0) {
        bot.sendMessage(chatId, '✅ No pending withdrawals');
        return;
      }

      for (const wd of withdrawals) {
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve_wd_${wd._id}` },
                { text: '❌ Reject', callback_data: `reject_wd_${wd._id}` }
              ]
            ]
          }
        };

        const message = `💸 *Pending Withdrawal*\n\n` +
          `👤 User: ${wd.username}\n` +
          `💵 Amount: PKR ${wd.amount}\n` +
          `🏦 Type: ${wd.accountType}\n` +
          `🔢 Account: ${wd.accountNumber}\n` +
          `📛 Title: ${wd.accountTitle}\n` +
          `📅 Date: ${new Date(wd.createdAt).toLocaleDateString()}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
      }
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error loading withdrawals');
    }
  }

  if (action === 'admin_plans') {
    try {
      const plans = await Plan.find().sort({ planId: 1 });
      let message = '📋 *All Plans*\n\n';
      plans.forEach(p => {
        message += `Plan ${p.planId}: ${p.name}\n` +
          `💰 Amount: PKR ${p.amount}\n` +
          `📈 Daily: ${p.dailyProfit}% | 📅 ${p.duration} Days\n` +
          `💎 Total Return: PKR ${(p.amount * p.dailyProfit / 100 * p.duration).toFixed(0)}\n\n`;
      });
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error loading plans');
    }
  }

  // Handle Approve/Reject Deposits
  if (query.data.startsWith('approve_dep_') || query.data.startsWith('reject_dep_')) {
    const parts = query.data.split('_');
    const action = parts[0];
    const tid = parts[2];
    
    try {
      const transaction = await Transaction.findById(tid);
      if (!transaction) {
        bot.sendMessage(chatId, '❌ Transaction not found');
        return;
      }

      transaction.status = action === 'approve' ? 'approved' : 'rejected';
      await transaction.save();

      if (action === 'approve') {
        const user = await User.findOne({ username: transaction.username });
        const plan = await Plan.findOne({ planId: transaction.planId });
        
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
        const firstDayProfit = plan.amount * (plan.dailyProfit / 100);
        user.balance += firstDayProfit;
        user.totalEarned += firstDayProfit;
        user.activePlan.profitDays += 1;
        await user.save();

        await new Transaction({
          userId: user._id,
          username: user.username,
          type: 'profit',
          amount: firstDayProfit,
          status: 'approved'
        }).save();

        // Referral Bonus
        if (user.referredBy) {
          const referrer = await User.findOne({ referralCode: user.referredBy });
          if (referrer) {
            const bonusPercent = await Setting.findOne({ key: 'referralBonus' });
            const bonus = plan.amount * (bonusPercent?.value || 11) / 100;
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

      bot.sendMessage(chatId, `✅ Deposit ${action === 'approve' ? 'Approved' : 'Rejected'}!\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  }

  // Handle Approve/Reject Withdrawals
  if (query.data.startsWith('approve_wd_') || query.data.startsWith('reject_wd_')) {
    const parts = query.data.split('_');
    const action = parts[0];
    const tid = parts[2];
    
    try {
      const transaction = await Transaction.findById(tid);
      if (!transaction) {
        bot.sendMessage(chatId, '❌ Transaction not found');
        return;
      }

      transaction.status = action === 'approve' ? 'approved' : 'rejected';
      await transaction.save();

      if (action === 'approve') {
        const user = await User.findOne({ username: transaction.username });
        user.balance -= transaction.amount;
        await user.save();
      }

      bot.sendMessage(chatId, `✅ Withdrawal ${action === 'approve' ? 'Approved' : 'Rejected'}!\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  }
});

// ============ MIDDLEWARE ============
function authMiddleware(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ MONGODB SCHEMAS ============
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  whatsapp: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String },
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
  userId: String,
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
  planId: Number,
  name: String,
  amount: Number,
  dailyProfit: { type: Number, default: 11 },
  duration: { type: Number, default: 60 }
});

const settingSchema = new mongoose.Schema({
  key: String,
  value: mongoose.Schema.Types.Mixed
});

const faqSchema = new mongoose.Schema({
  question: String,
  answer: String,
  order: Number
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// ============ INIT DEFAULT DATA ============
async function initData() {
  const planCount = await Plan.countDocuments();
  if (planCount === 0) {
    await Plan.insertMany([
      { planId: 1, name: 'Starter', amount: 360 },
      { planId: 2, name: 'Silver', amount: 860 },
      { planId: 3, name: 'Gold', amount: 1460 },
      { planId: 4, name: 'Platinum', amount: 2660 },
      { planId: 5, name: 'Diamond', amount: 4260 },
      { planId: 6, name: 'Ruby', amount: 6060 },
      { planId: 7, name: 'Emerald', amount: 9060 },
      { planId: 8, name: 'Sapphire', amount: 14060 },
      { planId: 9, name: 'Titanium', amount: 21060 },
      { planId: 10, name: 'Master', amount: 30000 },
      { planId: 11, name: 'Custom', amount: 50000 }
    ]);
  }

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
  }

  const faqCount = await FAQ.countDocuments();
  if (faqCount === 0) {
    await FAQ.insertMany([
      { question: 'How to invest?', answer: 'Select a plan, send payment, upload screenshot', order: 1 },
      { question: 'When do I get profit?', answer: 'Daily at 12:00 AM automatically', order: 2 },
      { question: 'Minimum withdrawal?', answer: 'PKR 30 minimum withdrawal', order: 3 }
    ]);
  }
}

// Telegram Notification Helper
async function notifyAdmin(message) {
  try {
    await bot.sendMessage(ADMIN_ID, message, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Telegram notification error:', err.message);
  }
}

// ============ API ROUTES ============

app.post('/api/signup', async (req, res) => {
  try {
    const { username, whatsapp, password, referralCode } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = Math.random().toString(36).substring(2, 10);

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
        await notifyAdmin(`🔗 <b>New Referral!</b>\n${username} joined using ${referrer.username}'s link`);
      }
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, username, referralCode: newReferralCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Account blocked' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayProfit = await Transaction.aggregate([
      { $match: { userId: req.userId, type: 'profit', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const referrals = await User.find({ referredBy: user.referralCode });

    res.json({
      username: user.username,
      balance: user.balance,
      activePlan: user.activePlan,
      totalInvested: user.totalInvested,
      totalEarned: user.totalEarned,
      referralEarnings: user.referralEarnings,
      referralCount: referrals.length,
      referralCode: user.referralCode,
      todayProfit: todayProfit[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plans', authMiddleware, async (req, res) => {
  try {
    const plans = await Plan.find().sort({ planId: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  try {
    const easypaisaNumber = await Setting.findOne({ key: 'easypaisaNumber' });
    const easypaisaTitle = await Setting.findOne({ key: 'easypaisaTitle' });
    const jazzcashNumber = await Setting.findOne({ key: 'jazzcashNumber' });
    const jazzcashTitle = await Setting.findOne({ key: 'jazzcashTitle' });

    res.json({
      easypaisa: { number: easypaisaNumber?.value, title: easypaisaTitle?.value },
      jazzcash: { number: jazzcashNumber?.value, title: jazzcashTitle?.value }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;
    const plan = await Plan.findOne({ planId: parseInt(planId) });
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const user = await User.findById(req.userId);
    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'deposit',
      amount: plan.amount,
      accountType,
      screenshot: req.file ? req.file.path : null,
      txId,
      planId: plan.planId
    });

    await transaction.save();

    await notifyAdmin(
      `💰 <b>New Deposit</b>\n\n` +
      `👤 User: ${user.username}\n` +
      `📋 Plan: ${plan.name}\n` +
      `💵 Amount: PKR ${plan.amount}\n` +
      `🔢 TxID: ${txId}\n` +
      `📅 ${new Date().toLocaleString()}`
    );

    res.json({ message: 'Deposit submitted!', transactionId: transaction._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;
    const user = await User.findById(req.userId);

    if (!user.activePlan) return res.status(400).json({ error: 'No active plan! Invest first.' });

    const minWithdraw = await Setting.findOne({ key: 'minWithdraw' });
    const maxWithdraw = await Setting.findOne({ key: 'maxWithdraw' });
    const maxDaily = await Setting.findOne({ key: 'maxDailyWithdraw' });

    if (amount < minWithdraw.value) return res.status(400).json({ error: `Min: PKR ${minWithdraw.value}` });
    if (amount > maxWithdraw.value) return res.status(400).json({ error: `Max: PKR ${maxWithdraw.value}` });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyTotal = await Transaction.aggregate([
      { $match: { userId: req.userId, type: 'withdraw', status: 'approved', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    if (dailyTotal.length > 0 && (dailyTotal[0].total + amount) > maxDaily.value) {
      return res.status(400).json({ error: 'Daily limit exceeded' });
    }

    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'withdraw',
      amount,
      accountType,
      accountNumber,
      accountTitle
    });

    await transaction.save();

    await notifyAdmin(
      `💸 <b>New Withdrawal</b>\n\n` +
      `👤 User: ${user.username}\n` +
      `💵 Amount: PKR ${amount}\n` +
      `🏦 Type: ${accountType}\n` +
      `🔢 Account: ${accountNumber}\n` +
      `📛 Title: ${accountTitle}\n` +
      `📅 ${new Date().toLocaleString()}`
    );

    res.json({ message: 'Withdrawal request submitted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deposits', authMiddleware, async (req, res) => {
  try {
    const deposits = await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/team', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const team = await User.find({ referredBy: user.referralCode });
    res.json({
      teamCount: team.length,
      team: team.map(m => ({
        username: m.username,
        totalInvested: m.totalInvested,
        totalEarned: m.totalEarned,
        joinedAt: m.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const topInvestors = await User.find({ status: 'active' })
      .sort({ totalInvested: -1 }).limit(10)
      .select('username totalInvested');

    const topReferrers = await User.aggregate([
      { $match: { status: 'active' } },
      { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'refs' } },
      { $project: { username: 1, count: { $size: '$refs' } } },
      { $sort: { count: -1 } }, { $limit: 10 }
    ]);

    res.json({ topInvestors, topReferrers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await FAQ.find().sort({ order: 1 });
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ DAILY PROFIT CRON ============
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily profit distribution...');
  try {
    const users = await User.find({
      'activePlan.endDate': { $gte: new Date() },
      'activePlan.profitDays': { $lt: 60 }
    });

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
      }
    }
    console.log(`Daily profit distributed to ${users.length} users`);
  } catch (err) {
    console.error('Profit distribution error:', err.message);
  }
});

// ============ SERVER START ============
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await initData();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB error:', err));
