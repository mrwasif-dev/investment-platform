require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Create uploads directory
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Multer config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ==================== MODELS ====================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  whatsapp: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  activePlan: {
    planId: Number, name: String, amount: Number,
    dailyProfit: Number, startDate: Date, endDate: Date,
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
  accountType: String, accountNumber: String, accountTitle: String,
  screenshot: String, txId: String, planId: Number,
  createdAt: { type: Date, default: Date.now }
});

const planSchema = new mongoose.Schema({
  planId: { type: Number, unique: true },
  name: String, amount: Number,
  dailyProfit: { type: Number, default: 11 },
  duration: { type: Number, default: 60 },
  isActive: { type: Boolean, default: true }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const faqSchema = new mongoose.Schema({
  question: String, answer: String,
  order: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// ==================== TELEGRAM BOT ====================
let bot = null;
const botSessions = {};

async function setupTelegramBot() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

  if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here' || !ADMIN_ID) {
    console.log('⚠️ Telegram Bot not configured - Admin panel will work via Web only');
    return;
  }

  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(BOT_TOKEN, { polling: true });

    console.log('✅ Telegram Bot connected');

    // Admin Menu
    const adminMenu = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Dashboard', callback_data: 'admin_dash' }],
          [{ text: '👥 Users', callback_data: 'admin_users' }, { text: '💰 Deposits', callback_data: 'admin_deps' }],
          [{ text: '💸 Withdrawals', callback_data: 'admin_wds' }, { text: '📋 Plans', callback_data: 'admin_plans' }],
          [{ text: '🏦 Accounts', callback_data: 'admin_accs' }, { text: '⚙️ Settings', callback_data: 'admin_sett' }],
          [{ text: '🔗 Referral', callback_data: 'admin_ref' }, { text: '❓ FAQ', callback_data: 'admin_faq' }],
          [{ text: '📢 Broadcast', callback_data: 'admin_bcast' }, { text: '🔄 Refresh', callback_data: 'admin_dash' }]
        ]
      }
    };

    bot.onText(/\/start|\/admin/, async (msg) => {
      if (msg.chat.id.toString() !== ADMIN_ID) return;
      await bot.sendMessage(ADMIN_ID, 
        '🔐 *ADMIN PANEL*\n\nWelcome! Full control:\n\n' +
        '• Manage Users & Plans\n• Approve/Reject Transactions\n• Change Settings & Accounts\n• Broadcast Messages\n• And more...',
        { parse_mode: 'Markdown', ...adminMenu }
      );
    });

    // Callback Handler
    bot.on('callback_query', async (query) => {
      const cid = query.message.chat.id.toString();
      if (cid !== ADMIN_ID) return bot.answerCallbackQuery(query.id);
      
      const action = query.data;
      await bot.answerCallbackQuery(query.id);

      try {
        // Dashboard
        if (action === 'admin_dash') {
          const users = await User.countDocuments();
          const active = await User.countDocuments({ 'activePlan.planId': {$exists:true}, status:'active' });
          const blocked = await User.countDocuments({ status:'blocked' });
          const pDeps = await Transaction.countDocuments({ type:'deposit', status:'pending' });
          const pWds = await Transaction.countDocuments({ type:'withdraw', status:'pending' });
          const totalDep = await Transaction.aggregate([{$match:{type:'deposit',status:'approved'}},{$group:{_id:null,total:{$sum:'$amount'}}}]);
          const totalWds = await Transaction.aggregate([{$match:{type:'withdraw',status:'approved'}},{$group:{_id:null,total:{$sum:'$amount'}}}]);
          const todayProfit = await Transaction.aggregate([{$match:{type:'profit',status:'approved',createdAt:{$gte:new Date(new Date().setHours(0,0,0,0))}}},{$group:{_id:null,total:{$sum:'$amount'},count:{$sum:1}}}]);

          const msg = `📊 *DASHBOARD*\n\n` +
            `👥 Users: ${users} (${active} active, ${blocked} blocked)\n` +
            `📥 Pending Deposits: ${pDeps}\n📤 Pending Withdrawals: ${pWds}\n` +
            `💰 Total Deposits: PKR ${(totalDep[0]?.total||0).toLocaleString()}\n` +
            `💸 Total Withdrawals: PKR ${(totalWds[0]?.total||0).toLocaleString()}\n` +
            `💎 Today Profit: PKR ${(todayProfit[0]?.total||0).toLocaleString()} (${todayProfit[0]?.count||0} times)`;
          
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // Users List
        else if (action === 'admin_users') {
          const users = await User.find().sort({createdAt:-1}).limit(20);
          let msg = `👥 *USERS* (${await User.countDocuments()} total)\n\n`;
          users.forEach((u,i) => {
            const icon = u.status==='blocked'?'🔴':(u.activePlan?.planId?'🟢':'🟡');
            msg += `${i+1}. ${icon} ${u.username} | PKR ${(u.totalInvested||0)}\n`;
          });
          msg += '\n🔍 /user <username> for details';
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // Pending Deposits
        else if (action === 'admin_deps') {
          const deps = await Transaction.find({type:'deposit',status:'pending'}).sort({createdAt:-1}).limit(10);
          if (!deps.length) return bot.editMessageText('✅ No pending deposits', { chat_id:cid, message_id:query.message.message_id, ...adminMenu });

          for (const d of deps) {
            const m = `💰 *DEPOSIT*\n👤 ${d.username}\n💵 PKR ${d.amount}\n🏦 ${d.accountType}\n🔢 ${d.txId}\n📅 ${new Date(d.createdAt).toLocaleDateString()}`;
            const kb = { reply_markup: { inline_keyboard: [[
              { text:'✅ Approve', callback_data:`appDep_${d._id}` },
              { text:'❌ Reject', callback_data:`rejDep_${d._id}` }
            ]]}};
            if (d.screenshot && fs.existsSync(d.screenshot)) {
              await bot.sendPhoto(cid, d.screenshot, { caption:m, parse_mode:'Markdown', ...kb });
            } else {
              await bot.sendMessage(cid, m, { parse_mode:'Markdown', ...kb });
            }
          }
        }

        // Pending Withdrawals
        else if (action === 'admin_wds') {
          const wds = await Transaction.find({type:'withdraw',status:'pending'}).sort({createdAt:-1}).limit(10);
          if (!wds.length) return bot.editMessageText('✅ No pending withdrawals', { chat_id:cid, message_id:query.message.message_id, ...adminMenu });

          for (const w of wds) {
            const u = await User.findOne({username:w.username});
            const m = `💸 *WITHDRAWAL*\n👤 ${w.username}\n💰 Balance: PKR ${(u?.balance||0).toFixed(2)}\n💵 Amount: PKR ${w.amount}\n🏦 ${w.accountType}: ${w.accountNumber}\n📛 ${w.accountTitle}`;
            const kb = { reply_markup: { inline_keyboard: [[
              { text:'✅ Approve', callback_data:`appWd_${w._id}` },
              { text:'❌ Reject', callback_data:`rejWd_${w._id}` }
            ]]}};
            await bot.sendMessage(cid, m, { parse_mode:'Markdown', ...kb });
          }
        }

        // Plans
        else if (action === 'admin_plans') {
          const plans = await Plan.find().sort({planId:1});
          let msg = `📋 *PLANS*\n\n`;
          plans.forEach(p => msg += `${p.isActive?'✅':'❌'} ${p.planId}. ${p.name} | PKR ${p.amount} | ${p.dailyProfit}% | ${p.duration}d\n`);
          const kb = { reply_markup: { inline_keyboard: [
            [{ text:'➕ Add Plan', callback_data:'addPlan' }, { text:'🗑️ Delete', callback_data:'delPlan' }],
            [{ text:'🔄 Toggle Active', callback_data:'togPlan' }, { text:'🔙 Back', callback_data:'admin_dash' }]
          ]}};
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...kb });
        }

        // Add Plan
        else if (action === 'addPlan') {
          botSessions[cid] = { step:'addPlan' };
          await bot.sendMessage(cid, '➕ *ADD PLAN*\n\nSend:\n`Name | Amount | Profit% | Days`\n\nExample:\n`Premium | 5000 | 12 | 60`', { parse_mode:'Markdown' });
        }

        // Delete Plan
        else if (action === 'delPlan') {
          const plans = await Plan.find().sort({planId:1});
          const kb = { reply_markup: { inline_keyboard: [
            ...plans.map(p => [{ text:`🗑️ ${p.planId}. ${p.name}`, callback_data:`delPlan_${p.planId}` }]),
            [{ text:'🔙 Back', callback_data:'admin_plans' }]
          ]}};
          await bot.editMessageText('Select plan to delete:', { chat_id:cid, message_id:query.message.message_id, ...kb });
        }

        // Toggle Plan
        else if (action === 'togPlan') {
          const plans = await Plan.find().sort({planId:1});
          const kb = { reply_markup: { inline_keyboard: [
            ...plans.map(p => [{ text:`${p.isActive?'✅':'❌'} ${p.planId}. ${p.name}`, callback_data:`togPlan_${p.planId}` }]),
            [{ text:'🔙 Back', callback_data:'admin_plans' }]
          ]}};
          await bot.editMessageText('Toggle plan active/inactive:', { chat_id:cid, message_id:query.message.message_id, ...kb });
        }

        // Execute Delete Plan
        else if (action.startsWith('delPlan_')) {
          const pid = parseInt(action.split('_')[1]);
          await Plan.deleteOne({planId:pid});
          await bot.sendMessage(cid, `✅ Plan ${pid} deleted!`, adminMenu);
        }

        // Execute Toggle Plan
        else if (action.startsWith('togPlan_')) {
          const pid = parseInt(action.split('_')[1]);
          const plan = await Plan.findOne({planId:pid});
          if (plan) { plan.isActive = !plan.isActive; await plan.save(); }
          await bot.sendMessage(cid, `✅ Plan ${pid} toggled!`, adminMenu);
        }

        // Payment Accounts
        else if (action === 'admin_accs') {
          const ep = await Setting.findOne({key:'easypaisaNumber'});
          const jc = await Setting.findOne({key:'jazzcashNumber'});
          const msg = `🏦 *ACCOUNTS*\n\nEasypaisa: ${ep?.value||'N/A'}\nJazzCash: ${jc?.value||'N/A'}\n\n📝 /setep number|title\n📝 /setjc number|title`;
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // Settings
        else if (action === 'admin_sett') {
          const minW = await Setting.findOne({key:'minWithdraw'});
          const maxW = await Setting.findOne({key:'maxWithdraw'});
          const dMax = await Setting.findOne({key:'maxDailyWithdraw'});
          const msg = `⚙️ *SETTINGS*\n\nMin Withdraw: PKR ${minW?.value||30}\nMax Withdraw: PKR ${maxW?.value||500000}\nDaily Limit: PKR ${dMax?.value||100000}\n\n/setminwd amount\n/setmaxwd amount\n/setdailywd amount`;
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // Referral
        else if (action === 'admin_ref') {
          const ref = await Setting.findOne({key:'referralBonus'});
          const msg = `🔗 *REFERRAL*\n\nBonus: ${ref?.value||11}%\n\n/setrefbonus percent`;
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // FAQ
        else if (action === 'admin_faq') {
          const faqs = await FAQ.find().sort({order:1});
          let msg = `❓ *FAQs*\n\n`;
          if (!faqs.length) msg += 'No FAQs\n';
          else faqs.forEach((f,i) => msg += `${i+1}. Q: ${f.question}\n   A: ${f.answer}\n\n`);
          msg += '/addfaq Q|A\n/delfaq number\n/clearfaqs';
          await bot.editMessageText(msg, { chat_id:cid, message_id:query.message.message_id, parse_mode:'Markdown', ...adminMenu });
        }

        // Broadcast
        else if (action === 'admin_bcast') {
          botSessions[cid] = { step:'broadcast' };
          await bot.sendMessage(cid, '📢 Send message to broadcast to all active users.\n\n/cancel to abort');
        }

        // Approve/Reject Deposit
        else if (action.startsWith('appDep_') || action.startsWith('rejDep_')) {
          const tid = action.split('_')[1];
          const status = action.startsWith('appDep_') ? 'approved' : 'rejected';
          const tx = await Transaction.findById(tid);
          if (!tx) return bot.sendMessage(cid, '❌ Not found');

          tx.status = status;
          await tx.save();

          if (status === 'approved') {
            const user = await User.findOne({username:tx.username});
            const plan = await Plan.findOne({planId:tx.planId});
            if (user && plan) {
              user.activePlan = {
                planId:plan.planId, name:plan.name, amount:plan.amount,
                dailyProfit:plan.amount*(plan.dailyProfit/100),
                startDate:new Date(),
                endDate:new Date(Date.now()+plan.duration*86400000),
                profitDays:0
              };
              user.totalInvested += plan.amount;
              const fp = plan.amount*(plan.dailyProfit/100);
              user.balance += fp;
              user.totalEarned += fp;
              user.activePlan.profitDays += 1;
              await user.save();
              await new Transaction({userId:user._id,username:user.username,type:'profit',amount:fp,status:'approved'}).save();

              if (user.referredBy) {
                const refUser = await User.findOne({referralCode:user.referredBy});
                if (refUser) {
                  const bonusPct = await Setting.findOne({key:'referralBonus'});
                  const bonus = plan.amount*((bonusPct?.value||11)/100);
                  refUser.balance += bonus;
                  refUser.referralEarnings += bonus;
                  await refUser.save();
                  await new Transaction({userId:refUser._id,username:refUser.username,type:'referral',amount:bonus,status:'approved'}).save();
                  bot.sendMessage(cid, `🎁 Bonus PKR ${bonus} → ${refUser.username}`);
                }
              }
            }
          }
          bot.sendMessage(cid, `✅ Deposit ${status}!`, adminMenu);
        }

        // Approve/Reject Withdrawal
        else if (action.startsWith('appWd_') || action.startsWith('rejWd_')) {
          const tid = action.split('_')[1];
          const status = action.startsWith('appWd_') ? 'approved' : 'rejected';
          const tx = await Transaction.findById(tid);
          if (!tx) return bot.sendMessage(cid, '❌ Not found');

          tx.status = status;
          await tx.save();

          if (status === 'approved') {
            const user = await User.findOne({username:tx.username});
            if (user) { user.balance -= tx.amount; await user.save(); }
          }
          bot.sendMessage(cid, `✅ Withdrawal ${status}!`, adminMenu);
        }

        // Back button
        else if (action === 'admin_dash') {
          // Already handled above, just send menu
          await bot.sendMessage(cid, '🔐 *ADMIN PANEL*', { parse_mode:'Markdown', ...adminMenu });
        }

      } catch (err) {
        console.error('Bot error:', err.message);
        bot.sendMessage(cid, `❌ Error: ${err.message}`, adminMenu);
      }
    });

    // Text commands
    bot.on('message', async (msg) => {
      const cid = msg.chat.id.toString();
      if (cid !== ADMIN_ID || !msg.text) return;
      const text = msg.text.trim();
      const session = botSessions[cid];

      if (text === '/cancel') {
        delete botSessions[cid];
        return bot.sendMessage(cid, '❌ Cancelled', adminMenu);
      }

      // Add Plan
      if (session?.step === 'addPlan') {
        const parts = text.split('|').map(s=>s.trim());
        if (parts.length < 4) return bot.sendMessage(cid, '❌ Format: Name|Amount|Profit%|Days');
        const last = await Plan.findOne().sort({planId:-1});
        const newId = last ? last.planId+1 : 1;
        await new Plan({planId:newId, name:parts[0], amount:parseInt(parts[1]), dailyProfit:parseFloat(parts[2]), duration:parseInt(parts[3])}).save();
        delete botSessions[cid];
        return bot.sendMessage(cid, `✅ Plan ${newId} added!`, adminMenu);
      }

      // Broadcast
      if (session?.step === 'broadcast') {
        const users = await User.find({status:'active'});
        let sent = 0;
        for (const u of users) {
          try { await bot.sendMessage(u._id, `📢 *Admin*\n\n${text}`, {parse_mode:'Markdown'}); sent++; }
          catch(e) {}
        }
        delete botSessions[cid];
        return bot.sendMessage(cid, `✅ Sent to ${sent}/${users.length}`, adminMenu);
      }

      // Commands
      if (text.startsWith('/setep ')) {
        const p = text.slice(7).split('|').map(s=>s.trim());
        if (p.length<2) return bot.sendMessage(cid, '❌ /setep number|title');
        await Setting.findOneAndUpdate({key:'easypaisaNumber'},{value:p[0]},{upsert:true});
        await Setting.findOneAndUpdate({key:'easypaisaTitle'},{value:p[1]},{upsert:true});
        return bot.sendMessage(cid, '✅ Easypaisa updated!');
      }
      if (text.startsWith('/setjc ')) {
        const p = text.slice(7).split('|').map(s=>s.trim());
        if (p.length<2) return bot.sendMessage(cid, '❌ /setjc number|title');
        await Setting.findOneAndUpdate({key:'jazzcashNumber'},{value:p[0]},{upsert:true});
        await Setting.findOneAndUpdate({key:'jazzcashTitle'},{value:p[1]},{upsert:true});
        return bot.sendMessage(cid, '✅ JazzCash updated!');
      }
      if (text.startsWith('/setminwd ')) {
        await Setting.findOneAndUpdate({key:'minWithdraw'},{value:parseInt(text.slice(10))},{upsert:true});
        return bot.sendMessage(cid, '✅ Updated!');
      }
      if (text.startsWith('/setmaxwd ')) {
        await Setting.findOneAndUpdate({key:'maxWithdraw'},{value:parseInt(text.slice(10))},{upsert:true});
        return bot.sendMessage(cid, '✅ Updated!');
      }
      if (text.startsWith('/setdailywd ')) {
        await Setting.findOneAndUpdate({key:'maxDailyWithdraw'},{value:parseInt(text.slice(12))},{upsert:true});
        return bot.sendMessage(cid, '✅ Updated!');
      }
      if (text.startsWith('/setrefbonus ')) {
        await Setting.findOneAndUpdate({key:'referralBonus'},{value:parseFloat(text.slice(13))},{upsert:true});
        return bot.sendMessage(cid, '✅ Updated!');
      }
      if (text.startsWith('/addfaq ')) {
        const p = text.slice(8).split('|').map(s=>s.trim());
        if (p.length<2) return bot.sendMessage(cid, '❌ /addfaq Q|A');
        const count = await FAQ.countDocuments();
        await new FAQ({question:p[0],answer:p[1],order:count+1}).save();
        return bot.sendMessage(cid, '✅ FAQ added!');
      }
      if (text.startsWith('/delfaq ')) {
        const n = parseInt(text.slice(8));
        const faqs = await FAQ.find().sort({order:1});
        if (n>0 && n<=faqs.length) { await FAQ.findByIdAndDelete(faqs[n-1]._id); return bot.sendMessage(cid, `✅ FAQ #${n} deleted!`); }
        return bot.sendMessage(cid, '❌ Invalid number');
      }
      if (text === '/clearfaqs') { await FAQ.deleteMany({}); return bot.sendMessage(cid, '✅ All FAQs deleted!'); }
      if (text.startsWith('/user ')) {
        const uname = text.slice(6).trim();
        const u = await User.findOne({username:uname});
        if (!u) return bot.sendMessage(cid, '❌ User not found');
        const plan = u.activePlan?.planId ? `${u.activePlan.name} (${u.activePlan.profitDays}/60)` : 'None';
        const um = `👤 *${u.username}*\n📱 ${u.whatsapp}\n💰 PKR ${(u.balance||0).toFixed(2)}\n📊 ${u.status}\n📋 ${plan}\n💵 Invested: PKR ${u.totalInvested||0}\n💎 Earned: PKR ${u.totalEarned||0}\n🔗 ${await User.countDocuments({referredBy:u.referralCode})} refs\n📅 ${new Date(u.createdAt).toLocaleDateString()}`;
        const kb = { reply_markup:{ inline_keyboard:[[
          { text:u.status==='active'?'🔴 Block':'🟢 Unblock', callback_data:`userToggle_${u.username}` }
        ]]}};
        return bot.sendMessage(cid, um, { parse_mode:'Markdown', ...kb });
      }
    });

    // User Toggle callback (separate to avoid conflict)
    bot.on('callback_query', async (q) => {
      if (q.data.startsWith('userToggle_')) {
        const uname = q.data.split('_')[1];
        const u = await User.findOne({username:uname});
        if (u) { u.status = u.status==='active'?'blocked':'active'; await u.save(); }
        await bot.answerCallbackQuery(q.id);
        bot.sendMessage(q.message.chat.id, `✅ ${uname} → ${u.status}`);
      }
    });

  } catch (err) {
    console.error('Telegram Bot setup error:', err.message);
    bot = null;
  }
}

// ==================== AUTH MIDDLEWARE ====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== API ROUTES ====================

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/api/signup', async (req, res) => {
  try {
    const { username, whatsapp, password, referralCode } = req.body;
    if (!username || !whatsapp || !password) return res.status(400).json({ error: 'All fields required' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username taken' });

    const user = new User({
      username, whatsapp,
      password: await bcrypt.hash(password, 10),
      referralCode: Math.random().toString(36).substring(2, 10).toUpperCase(),
      referredBy: referralCode || null
    });
    await user.save();

    if (bot && referralCode) {
      const ref = await User.findOne({ referralCode });
      if (ref) bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, `🔗 ${username} joined via ${ref.username}`, { parse_mode: 'HTML' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, referralCode: user.referralCode });
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
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Wrong password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = new Date(); today.setHours(0,0,0,0);
  const tp = await Transaction.aggregate([
    { $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  res.json({
    username: user.username, balance: user.balance || 0,
    activePlan: user.activePlan || null,
    totalInvested: user.totalInvested || 0,
    totalEarned: user.totalEarned || 0,
    referralEarnings: user.referralEarnings || 0,
    referralCount: await User.countDocuments({ referredBy: user.referralCode }),
    referralCode: user.referralCode,
    todayProfit: tp[0]?.total || 0
  });
});

app.get('/api/plans', authMiddleware, async (req, res) => {
  res.json(await Plan.find({ isActive: true }).sort({ planId: 1 }));
});

app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  const [epN, epT, jcN, jcT] = await Promise.all([
    Setting.findOne({ key: 'easypaisaNumber' }), Setting.findOne({ key: 'easypaisaTitle' }),
    Setting.findOne({ key: 'jazzcashNumber' }), Setting.findOne({ key: 'jazzcashTitle' })
  ]);
  res.json({
    easypaisa: { number: epN?.value || 'N/A', title: epT?.value || 'N/A' },
    jazzcash: { number: jcN?.value || 'N/A', title: jcT?.value || 'N/A' }
  });
});

app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;
    if (!planId || !accountType || !txId || !req.file) return res.status(400).json({ error: 'All fields + screenshot required' });

    const plan = await Plan.findOne({ planId: parseInt(planId) });
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const user = await User.findById(req.userId);
    await new Transaction({
      userId: req.userId, username: user.username, type: 'deposit',
      amount: plan.amount, accountType, screenshot: req.file.path, txId, planId: plan.planId
    }).save();

    res.json({ message: '✅ Deposit submitted! Awaiting approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;
    const user = await User.findById(req.userId);
    const amt = parseFloat(amount);

    if (!user.activePlan?.planId) return res.status(400).json({ error: 'No active plan. Invest first!' });
    if (user.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });

    const minW = await Setting.findOne({ key: 'minWithdraw' });
    const maxW = await Setting.findOne({ key: 'maxWithdraw' });
    if (amt < (minW?.value || 30)) return res.status(400).json({ error: `Min: PKR ${minW?.value || 30}` });
    if (amt > (maxW?.value || 500000)) return res.status(400).json({ error: `Max: PKR ${maxW?.value || 500000}` });

    await new Transaction({
      userId: req.userId, username: user.username, type: 'withdraw',
      amount: amt, accountType, accountNumber, accountTitle
    }).save();

    res.json({ message: '✅ Withdrawal submitted! Awaiting approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  res.json(await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50));
});

app.get('/api/deposits', authMiddleware, async (req, res) => {
  res.json(await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(20));
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  res.json(await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(20));
});

app.get('/api/team', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  const team = await User.find({ referredBy: user.referralCode }).select('username totalInvested createdAt').sort({ createdAt: -1 });
  res.json({ teamCount: team.length, team });
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  const topInv = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username totalInvested');
  const topRef = await User.aggregate([
    { $match: { status: 'active' } },
    { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'refs' } },
    { $project: { username: 1, count: { $size: '$refs' } } },
    { $sort: { count: -1 } }, { $limit: 10 }
  ]);
  res.json({ topInvestors: topInv, topReferrers: topRef });
});

app.get('/api/faqs', async (req, res) => {
  res.json(await FAQ.find().sort({ order: 1 }));
});

// ==================== DAILY PROFIT ====================
cron.schedule('0 0 * * *', async () => {
  console.log('🕛 Daily profit running...');
  const users = await User.find({
    'activePlan.planId': { $exists: true },
    'activePlan.endDate': { $gte: new Date() },
    'activePlan.profitDays': { $lt: 60 },
    status: 'active'
  });
  let c = 0;
  for (const u of users) {
    u.balance += u.activePlan.dailyProfit;
    u.totalEarned += u.activePlan.dailyProfit;
    u.activePlan.profitDays += 1;
    await u.save();
    await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: u.activePlan.dailyProfit, status: 'approved' }).save();
    c++;
  }
  console.log(`✅ Profit to ${c} users`);
});

// ==================== INIT ====================
async function init() {
  if (await Plan.countDocuments() === 0) {
    await Plan.insertMany([
      { planId: 1, name: 'Starter', amount: 360 }, { planId: 2, name: 'Silver', amount: 860 },
      { planId: 3, name: 'Gold', amount: 1460 }, { planId: 4, name: 'Platinum', amount: 2660 },
      { planId: 5, name: 'Diamond', amount: 4260 }, { planId: 6, name: 'Ruby', amount: 6060 },
      { planId: 7, name: 'Emerald', amount: 9060 }, { planId: 8, name: 'Sapphire', amount: 14060 },
      { planId: 9, name: 'Titanium', amount: 21060 }, { planId: 10, name: 'Master', amount: 30000 },
      { planId: 11, name: 'Custom', amount: 50000 }
    ]);
    console.log('✅ Plans created');
  }
  if (await Setting.countDocuments() === 0) {
    await Setting.insertMany([
      { key: 'referralBonus', value: 11 }, { key: 'minWithdraw', value: 30 },
      { key: 'maxWithdraw', value: 500000 }, { key: 'maxDailyWithdraw', value: 100000 },
      { key: 'easypaisaNumber', value: '03001234567' }, { key: 'easypaisaTitle', value: 'Platform Name' },
      { key: 'jazzcashNumber', value: '03009876543' }, { key: 'jazzcashTitle', value: 'Platform Name' }
    ]);
    console.log('✅ Settings created');
  }
  if (await FAQ.countDocuments() === 0) {
    await FAQ.insertMany([
      { question: 'How to invest?', answer: 'Select a plan, send payment to the given account, upload screenshot with Transaction ID.', order: 1 },
      { question: 'When do I get profit?', answer: 'First profit is credited immediately after deposit approval. Then daily at 12:00 AM for 60 days.', order: 2 },
      { question: 'Minimum withdrawal?', answer: 'PKR 30 minimum withdrawal. Maximum PKR 500,000 per request.', order: 3 },
      { question: 'How does referral work?', answer: 'Share your unique link. When someone joins and invests, you get 11% bonus instantly!', order: 4 }
    ]);
    console.log('✅ FAQs created');
  }
}

// ==================== START ====================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/investment_db')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await init();
    await setupTelegramBot();
    app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });
