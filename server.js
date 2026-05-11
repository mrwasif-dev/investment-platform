const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer config for screenshots
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  whatsapp: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String },
  activePlan: {
    planId: Number,
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

// Models
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// Initialize default data
async function initializeData() {
  const planCount = await Plan.countDocuments();
  if (planCount === 0) {
    const plans = [
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
    ];
    await Plan.insertMany(plans);
  }

  const settingsCount = await Setting.countDocuments();
  if (settingsCount === 0) {
    const settings = [
      { key: 'referralBonus', value: 11 },
      { key: 'minWithdraw', value: 30 },
      { key: 'maxWithdraw', value: 500000 },
      { key: 'maxDailyWithdraw', value: 100000 },
      { key: 'easypaisaNumber', value: '03001234567' },
      { key: 'easypaisaTitle', value: 'Investment Platform' },
      { key: 'jazzcashNumber', value: '03009876543' },
      { key: 'jazzcashTitle', value: 'Investment Platform' }
    ];
    await Setting.insertMany(settings);
  }
}

// Auth Middleware
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

// Telegram notification function
async function notifyAdmin(message) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: adminId,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Telegram notification error:', err.message);
  }
}

// ============ ROUTES ============

// Signup
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

    // If referred, add referral record
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        await notifyAdmin(`🔗 New referral: ${username} joined using ${referrer.username}'s link`);
      }
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, username: user.username, referralCode: newReferralCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Account blocked' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Dashboard Data
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const referrals = await User.find({ referredBy: user.referralCode });
    
    res.json({
      username: user.username,
      balance: user.balance,
      activePlan: user.activePlan,
      totalInvested: user.totalInvested,
      totalEarned: user.totalEarned,
      referralEarnings: user.referralEarnings,
      referralCount: referrals.length,
      referralCode: user.referralCode
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Plans
app.get('/api/plans', authMiddleware, async (req, res) => {
  try {
    const plans = await Plan.find().sort({ planId: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Deposit Account Details
app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  try {
    const easypaisaNumber = await Setting.findOne({ key: 'easypaisaNumber' });
    const easypaisaTitle = await Setting.findOne({ key: 'easypaisaTitle' });
    const jazzcashNumber = await Setting.findOne({ key: 'jazzcashNumber' });
    const jazzcashTitle = await Setting.findOne({ key: 'jazzcashTitle' });

    res.json({
      easypaisa: {
        number: easypaisaNumber?.value,
        title: easypaisaTitle?.value
      },
      jazzcash: {
        number: jazzcashNumber?.value,
        title: jazzcashTitle?.value
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Deposit
app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;
    const plan = await Plan.findOne({ planId: parseInt(planId) });
    
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const transaction = new Transaction({
      userId: req.userId,
      username: (await User.findById(req.userId)).username,
      type: 'deposit',
      amount: plan.amount,
      accountType,
      screenshot: req.file?.path,
      txId,
      planId: plan.planId
    });

    await transaction.save();

    await notifyAdmin(`💰 New Deposit Pending\nUser: ${transaction.username}\nPlan: ${plan.name}\nAmount: PKR ${plan.amount}\nTxID: ${txId}`);

    res.json({ message: 'Deposit submitted for approval', transactionId: transaction._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Withdrawal
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;
    const user = await User.findById(req.userId);

    if (!user.activePlan) {
      return res.status(400).json({ error: 'No active plan found. Please invest first.' });
    }

    const minWithdraw = await Setting.findOne({ key: 'minWithdraw' });
    const maxWithdraw = await Setting.findOne({ key: 'maxWithdraw' });
    const maxDaily = await Setting.findOne({ key: 'maxDailyWithdraw' });

    if (amount < minWithdraw.value) return res.status(400).json({ error: `Minimum withdrawal is PKR ${minWithdraw.value}` });
    if (amount > maxWithdraw.value) return res.status(400).json({ error: `Maximum withdrawal is PKR ${maxWithdraw.value}` });

    // Check daily withdrawal limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyTotal = await Transaction.aggregate([
      { $match: { userId: req.userId, type: 'withdraw', status: 'approved', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    if (dailyTotal.length > 0 && (dailyTotal[0].total + amount) > maxDaily.value) {
      return res.status(400).json({ error: 'Daily withdrawal limit exceeded' });
    }

    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'withdraw',
      amount,
      accountType,
      accountNumber,
      accountTitle,
      status: 'pending'
    });

    await transaction.save();

    await notifyAdmin(`💸 New Withdrawal Request\nUser: ${user.username}\nAmount: PKR ${amount}\nType: ${accountType}\nNumber: ${accountNumber}`);

    res.json({ message: 'Withdrawal request submitted', transactionId: transaction._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Transaction History
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Deposit History
app.get('/api/deposits', authMiddleware, async (req, res) => {
  try {
    const deposits = await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Withdrawal History
app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Team Members
app.get('/api/team', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const team = await User.find({ referredBy: user.referralCode });
    
    const teamData = team.map(member => ({
      username: member.username,
      totalInvested: member.totalInvested,
      joinedAt: member.createdAt
    }));

    res.json({ teamCount: team.length, team: teamData });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'referrals' } },
      { $project: { username: 1, referralCount: { $size: '$referrals' } } },
      { $sort: { referralCount: -1 } },
      { $limit: 10 }
    ]);

    res.json({ topInvestors, topReferrers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get FAQs
app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await FAQ.find().sort({ order: 1 });
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Get pending deposits
app.get('/api/admin/pending-deposits', async (req, res) => {
  try {
    const deposits = await Transaction.find({ type: 'deposit', status: 'pending' });
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Approve/Reject deposit
app.post('/api/admin/deposit-action', async (req, res) => {
  try {
    const { transactionId, action } = req.body;
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    transaction.status = action;
    await transaction.save();

    if (action === 'approved') {
      const user = await User.findOne({ username: transaction.username });
      const plan = await Plan.findOne({ planId: transaction.planId });
      
      // Active plan setup
      user.activePlan = {
        planId: plan.planId,
        amount: plan.amount,
        dailyProfit: plan.amount * (plan.dailyProfit / 100),
        startDate: new Date(),
        endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
        profitDays: 0
      };
      
      user.totalInvested += plan.amount;
      
      // First day profit immediately
      const firstDayProfit = plan.amount * (plan.dailyProfit / 100);
      user.balance += firstDayProfit;
      user.totalEarned += firstDayProfit;
      user.activePlan.profitDays += 1;

      await user.save();

      // Profit transaction
      await new Transaction({
        userId: user._id,
        username: user.username,
        type: 'profit',
        amount: firstDayProfit,
        status: 'approved'
      }).save();

      // Referral bonus
      if (user.referredBy) {
        const referrer = await User.findOne({ referralCode: user.referredBy });
        if (referrer) {
          const bonusPercent = await Setting.findOne({ key: 'referralBonus' });
          const bonus = plan.amount * (bonusPercent.value / 100);
          
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

          await notifyAdmin(`🎉 Referral Bonus: ${referrer.username} got PKR ${bonus} from ${user.username}'s deposit`);
        }
      }

      await notifyAdmin(`✅ Deposit Approved\nUser: ${user.username}\nPlan: ${plan.name}\nAmount: PKR ${plan.amount}`);
    } else {
      await notifyAdmin(`❌ Deposit Rejected\nUser: ${transaction.username}\nTxID: ${transaction.txId}`);
    }

    res.json({ message: `Deposit ${action}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Get pending withdrawals
app.get('/api/admin/pending-withdrawals', async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: 'withdraw', status: 'pending' });
    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Approve/Reject withdrawal
app.post('/api/admin/withdraw-action', async (req, res) => {
  try {
    const { transactionId, action } = req.body;
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    transaction.status = action;
    await transaction.save();

    if (action === 'approved') {
      const user = await User.findOne({ username: transaction.username });
      user.balance -= transaction.amount;
      await user.save();
      await notifyAdmin(`✅ Withdrawal Approved\nUser: ${user.username}\nAmount: PKR ${transaction.amount}`);
    } else {
      await notifyAdmin(`❌ Withdrawal Rejected\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
    }

    res.json({ message: `Withdrawal ${action}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Update Settings
app.post('/api/admin/update-setting', async (req, res) => {
  try {
    const { key, value } = req.body;
    await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
    await notifyAdmin(`⚙️ Setting Updated: ${key} = ${value}`);
    res.json({ message: 'Setting updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Block/Unblock User
app.post('/api/admin/toggle-user', async (req, res) => {
  try {
    const { username, status } = req.body;
    await User.findOneAndUpdate({ username }, { status });
    await notifyAdmin(`👤 User ${username} has been ${status}`);
    res.json({ message: `User ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin API: Broadcast message
app.post('/api/admin/broadcast', async (req, res) => {
  try {
    const { message } = req.body;
    const users = await User.find({ status: 'active' });
    
    for (const user of users) {
      // In production, you'd send WhatsApp messages here
      console.log(`Broadcasting to ${user.username}: ${message}`);
    }
    
    await notifyAdmin(`📢 Broadcast sent to ${users.length} users`);
    res.json({ message: `Broadcast sent to ${users.length} users` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily profit distribution (runs at midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily profit distribution...');
  try {
    const users = await User.find({ 'activePlan.endDate': { $gte: new Date() } });
    
    for (const user of users) {
      if (user.activePlan && user.activePlan.profitDays < 60) {
        const profit = user.activePlan.amount * (11 / 100);
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

        console.log(`Daily profit of PKR ${profit} added to ${user.username}`);
      }
    }
  } catch (err) {
    console.error('Profit distribution error:', err.message);
  }
});

// MongoDB Connection & Server Start
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await initializeData();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));
