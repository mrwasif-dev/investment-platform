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

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const botSessions = {};

let bot = null;
if (BOT_TOKEN && BOT_TOKEN !== 'your_bot_token_here') {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
}

function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Dashboard Stats', callback_data: 'm_dash' }],
        [{ text: '👥 Users Management', callback_data: 'm_users' }],
        [{ text: '💰 Pending Deposits', callback_data: 'm_deps' }],
        [{ text: '💸 Pending Withdrawals', callback_data: 'm_wds' }],
        [{ text: '📋 Manage Plans', callback_data: 'm_plans' }],
        [{ text: '🏦 Payment Accounts', callback_data: 'm_accounts' }],
        [{ text: '⚙️ System Settings', callback_data: 'm_settings' }],
        [{ text: '🔗 Referral Settings', callback_data: 'm_referral' }],
        [{ text: '❓ FAQ Management', callback_data: 'm_faq' }],
        [{ text: '📢 Broadcast Message', callback_data: 'm_broadcast' }]
      ]
    }
  };
}

function getBackButton(data) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 Back to Main Menu', callback_data: 'm_main' }]]
    }
  };
}

// ============ TELEGRAM BOT ============
if (bot) {
  bot.onText(/\/start|\/admin/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return bot.sendMessage(chatId, '⛔ Unauthorized');
    
    bot.sendMessage(chatId, '🔐 *ADMIN PANEL*\n\nFull control over the platform:', { parse_mode: 'Markdown', ...getMainMenu() });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    if (chatId !== ADMIN_ID) return bot.answerCallbackQuery(query.id);

    const action = query.data;
    await bot.answerCallbackQuery(query.id);

    try {
      // ========== MAIN MENU ==========
      if (action === 'm_main') {
        await bot.deleteMessage(chatId, query.message.message_id);
        bot.sendMessage(chatId, '🔐 *ADMIN PANEL*\n\nSelect an option:', { parse_mode: 'Markdown', ...getMainMenu() });
      }

      // ========== DASHBOARD ==========
      else if (action === 'm_dash') {
        const totalUsers = await User.countDocuments();
        const activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true }, status: 'active' });
        const pendingDeps = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
        const pendingWds = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
        
        const totalDep = await Transaction.aggregate([
          { $match: { type: 'deposit', status: 'approved' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const todayProfit = await Transaction.aggregate([
          { $match: { type: 'profit', status: 'approved', createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const statsMsg = `📊 *DASHBOARD STATISTICS*\n\n` +
          `👥 Total Users: ${totalUsers}\n` +
          `✅ Active Plans: ${activePlans}\n` +
          `📥 Pending Deposits: ${pendingDeps}\n` +
          `📤 Pending Withdrawals: ${pendingWds}\n` +
          `💰 Total Deposits: PKR ${totalDep[0]?.total?.toLocaleString() || 0}\n` +
          `💎 Today's Profit: PKR ${todayProfit[0]?.total?.toLocaleString() || 0}\n` +
          `🔄 Profit Given: ${todayProfit[0]?.count || 0} times`;

        await bot.editMessageText(statsMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== USERS ==========
      else if (action === 'm_users') {
        const users = await User.find().sort({ createdAt: -1 }).limit(30);
        let usersMsg = '👥 *ALL USERS*\n\n';
        users.forEach((u, i) => {
          usersMsg += `${i+1}. ${u.status === 'blocked' ? '🔴' : '🟢'} ${u.username}\n   💰 PKR ${u.totalInvested || 0}\n\n`;
        });
        usersMsg += `\nTotal: ${await User.countDocuments()}\nUse: /user <username>`;

        await bot.editMessageText(usersMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== PENDING DEPOSITS ==========
      else if (action === 'm_deps') {
        const deps = await Transaction.find({ type: 'deposit', status: 'pending' }).sort({ createdAt: -1 }).limit(10);

        if (deps.length === 0) {
          await bot.editMessageText('✅ No pending deposits', { chat_id: chatId, message_id: query.message.message_id, ...getBackButton('m_main') });
          return;
        }

        for (const dep of deps) {
          const depMsg = `💰 *PENDING DEPOSIT*\n\n` +
            `👤 ${dep.username}\n` +
            `💵 PKR ${dep.amount}\n` +
            `🏦 ${dep.accountType}\n` +
            `🔢 ${dep.txId}\n` +
            `📅 ${new Date(dep.createdAt).toLocaleString()}`;

          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `dep_approve_${dep._id}` },
                { text: '❌ Reject', callback_data: `dep_reject_${dep._id}` }
              ]]
            }
          };

          if (dep.screenshot && fs.existsSync(path.join(__dirname, dep.screenshot))) {
            await bot.sendPhoto(chatId, path.join(__dirname, dep.screenshot), { caption: depMsg, parse_mode: 'Markdown', ...keyboard });
          } else {
            await bot.sendMessage(chatId, depMsg, { parse_mode: 'Markdown', ...keyboard });
          }
        }
      }

      // ========== PENDING WITHDRAWALS ==========
      else if (action === 'm_wds') {
        const wds = await Transaction.find({ type: 'withdraw', status: 'pending' }).sort({ createdAt: -1 }).limit(10);

        if (wds.length === 0) {
          await bot.editMessageText('✅ No pending withdrawals', { chat_id: chatId, message_id: query.message.message_id, ...getBackButton('m_main') });
          return;
        }

        for (const wd of wds) {
          const user = await User.findOne({ username: wd.username });
          const wdMsg = `💸 *PENDING WITHDRAWAL*\n\n` +
            `👤 ${wd.username}\n` +
            `💰 Balance: PKR ${user?.balance?.toFixed(2) || 0}\n` +
            `💵 Amount: PKR ${wd.amount}\n` +
            `🏦 ${wd.accountType}\n` +
            `🔢 ${wd.accountNumber}\n` +
            `📛 ${wd.accountTitle}`;

          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `wd_approve_${wd._id}` },
                { text: '❌ Reject', callback_data: `wd_reject_${wd._id}` }
              ]]
            }
          };

          await bot.sendMessage(chatId, wdMsg, { parse_mode: 'Markdown', ...keyboard });
        }
      }

      // ========== MANAGE PLANS ==========
      else if (action === 'm_plans') {
        const plans = await Plan.find().sort({ planId: 1 });
        let plansMsg = '📋 *ALL PLANS*\n\n';
        plans.forEach(p => {
          const status = p.isActive ? '✅' : '❌';
          plansMsg += `${status} Plan ${p.planId}: ${p.name}\n   PKR ${p.amount} | ${p.dailyProfit}% | ${p.duration} Days\n\n`;
        });

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add Plan', callback_data: 'p_add' }, { text: '🗑️ Delete Plan', callback_data: 'p_delete_select' }],
              [{ text: '🔙 Back', callback_data: 'm_main' }]
            ]
          }
        };

        await bot.editMessageText(plansMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...keyboard });
      }

      // ========== ADD PLAN ==========
      else if (action === 'p_add') {
        botSessions[chatId] = { action: 'adding_plan' };
        await bot.sendMessage(chatId, '➕ *ADD PLAN*\n\nSend: `Name | Amount | Profit% | Days`\nExample: `Premium | 5000 | 11 | 60`\n\n/cancel to abort', { parse_mode: 'Markdown' });
      }

      // ========== DELETE PLAN ==========
      else if (action === 'p_delete_select') {
        const plans = await Plan.find().sort({ planId: 1 });
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              ...plans.map(p => [{ text: `🗑️ Plan ${p.planId}: ${p.name}`, callback_data: `p_delete_${p.planId}` }]),
              [{ text: '🔙 Back', callback_data: 'm_plans' }]
            ]
          }
        };
        await bot.editMessageText('Select plan to delete:', { chat_id: chatId, message_id: query.message.message_id, ...keyboard });
      }

      // ========== CONFIRM DELETE PLAN ==========
      else if (action.startsWith('p_delete_')) {
        const planId = parseInt(action.split('_')[2]);
        const plan = await Plan.findOne({ planId });
        if (!plan) return bot.sendMessage(chatId, '❌ Plan not found');

        const keyboard = {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Yes Delete', callback_data: `p_delete_confirm_${planId}` },
              { text: '❌ Cancel', callback_data: 'm_plans' }
            ]]
          }
        };
        await bot.sendMessage(chatId, `🗑️ Delete ${plan.name}?\nPKR ${plan.amount}`, { ...keyboard });
      }

      // ========== EXECUTE DELETE PLAN ==========
      else if (action.startsWith('p_delete_confirm_')) {
        const planId = parseInt(action.split('_')[3]);
        await Plan.deleteOne({ planId });
        await bot.sendMessage(chatId, `✅ Plan ${planId} deleted!`, getBackButton('m_plans'));
      }

      // ========== PAYMENT ACCOUNTS ==========
      else if (action === 'm_accounts') {
        const epNum = await Setting.findOne({ key: 'easypaisaNumber' });
        const epTitle = await Setting.findOne({ key: 'easypaisaTitle' });
        const jcNum = await Setting.findOne({ key: 'jazzcashNumber' });
        const jcTitle = await Setting.findOne({ key: 'jazzcashTitle' });

        const accMsg = `🏦 *PAYMENT ACCOUNTS*\n\n` +
          `*Easypaisa:*\n📱 ${epNum?.value || 'N/A'}\n📛 ${epTitle?.value || 'N/A'}\n\n` +
          `*JazzCash:*\n📱 ${jcNum?.value || 'N/A'}\n📛 ${jcTitle?.value || 'N/A'}\n\n` +
          `Change:\n/setep number | title\n/setjc number | title`;

        await bot.editMessageText(accMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== SETTINGS ==========
      else if (action === 'm_settings') {
        const settings = await Setting.find({});
        let setMsg = '⚙️ *SETTINGS*\n\n';
        settings.forEach(s => { setMsg += `• ${s.key}: ${s.value}\n`; });
        setMsg += '\n/setminwd amount\n/setmaxwd amount\n/setdailywd amount\n/setrefbonus %';

        await bot.editMessageText(setMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== REFERRAL ==========
      else if (action === 'm_referral') {
        const bonus = await Setting.findOne({ key: 'referralBonus' });
        const refMsg = `🔗 *REFERRAL*\n\nBonus: ${bonus?.value || 11}%\n\n/setrefbonus percent`;
        await bot.editMessageText(refMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== FAQ ==========
      else if (action === 'm_faq') {
        const faqs = await FAQ.find().sort({ order: 1 });
        let faqMsg = '❓ *FAQs*\n\n';
        if (faqs.length === 0) {
          faqMsg += 'No FAQs\n\n';
        } else {
          faqs.forEach((f, i) => {
            faqMsg += `${i+1}. Q: ${f.question}\n   A: ${f.answer}\n\n`;
          });
        }
        faqMsg += '/addfaq Q | A\n/delfaq number\n/clearfaqs';
        await bot.editMessageText(faqMsg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ========== BROADCAST ==========
      else if (action === 'm_broadcast') {
        botSessions[chatId] = { action: 'broadcast' };
        await bot.sendMessage(chatId, '📢 Send message to broadcast:\n/cancel to abort');
      }

      // ========== DEPOSIT APPROVE/REJECT ==========
      else if (action.startsWith('dep_approve_') || action.startsWith('dep_reject_')) {
        const parts = action.split('_');
        const status = parts[0] === 'dep' ? (parts[1] === 'approve' ? 'approved' : 'rejected') : 'rejected';
        const tid = parts[2];
        
        const transaction = await Transaction.findById(tid);
        if (!transaction) return bot.sendMessage(chatId, '❌ Not found');

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

        bot.sendMessage(chatId, `✅ Deposit ${status}!\n${transaction.username}\nPKR ${transaction.amount}`);
      }

      // ========== WITHDRAWAL APPROVE/REJECT ==========
      else if (action.startsWith('wd_approve_') || action.startsWith('wd_reject_')) {
        const parts = action.split('_');
        const status = parts[0] === 'wd' ? (parts[1] === 'approve' ? 'approved' : 'rejected') : 'rejected';
        const tid = parts[2];
        
        const transaction = await Transaction.findById(tid);
        if (!transaction) return bot.sendMessage(chatId, '❌ Not found');

        transaction.status = status;
        await transaction.save();

        if (status === 'approved') {
          const user = await User.findOne({ username: transaction.username });
          if (user) {
            user.balance -= transaction.amount;
            await user.save();
          }
        }

        bot.sendMessage(chatId, `✅ Withdrawal ${status}!\n${transaction.username}\nPKR ${transaction.amount}`);
      }

    } catch (err) {
      console.error('Bot error:', err.message);
      bot.sendMessage(chatId, '❌ Error: ' + err.message);
    }
  });

  // ========== TEXT COMMANDS ==========
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID || !msg.text) return;

    const text = msg.text.trim();
    const session = botSessions[chatId];

    // Cancel
    if (text === '/cancel') {
      delete botSessions[chatId];
      return bot.sendMessage(chatId, '❌ Cancelled', getMainMenu());
    }

    // Add Plan
    if (session && session.action === 'adding_plan') {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 4) {
        return bot.sendMessage(chatId, '❌ Format: Name | Amount | Profit% | Days');
      }

      const lastPlan = await Plan.findOne().sort({ planId: -1 });
      const newPlanId = lastPlan ? lastPlan.planId + 1 : 1;
      
      await new Plan({
        planId: newPlanId,
        name: parts[0],
        amount: parseInt(parts[1]),
        dailyProfit: parseFloat(parts[2]),
        duration: parseInt(parts[3])
      }).save();

      delete botSessions[chatId];
      return bot.sendMessage(chatId, `✅ Plan ${newPlanId} added!`, getMainMenu());
    }

    // Broadcast
    if (session && session.action === 'broadcast') {
      const users = await User.find({ status: 'active' });
      let sent = 0;
      for (const user of users) {
        try {
          await bot.sendMessage(user._id, `📢 *Admin Message*\n\n${text}`, { parse_mode: 'Markdown' });
          sent++;
        } catch (e) {}
      }
      delete botSessions[chatId];
      return bot.sendMessage(chatId, `✅ Sent to ${sent}/${users.length}`, getMainMenu());
    }

    // Set Easypaisa
    if (text.startsWith('/setep ')) {
      const parts = text.replace('/setep ', '').split('|').map(s => s.trim());
      if (parts.length < 2) return bot.sendMessage(chatId, '❌ /setep number | title');
      await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: parts[0] }, { upsert: true });
      await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: parts[1] }, { upsert: true });
      return bot.sendMessage(chatId, '✅ Easypaisa updated!');
    }

    // Set JazzCash
    if (text.startsWith('/setjc ')) {
      const parts = text.replace('/setjc ', '').split('|').map(s => s.trim());
      if (parts.length < 2) return bot.sendMessage(chatId, '❌ /setjc number | title');
      await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: parts[0] }, { upsert: true });
      await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: parts[1] }, { upsert: true });
      return bot.sendMessage(chatId, '✅ JazzCash updated!');
    }

    // Set Min Withdrawal
    if (text.startsWith('/setminwd ')) {
      const val = parseInt(text.replace('/setminwd ', ''));
      await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: val }, { upsert: true });
      return bot.sendMessage(chatId, `✅ Min withdrawal: PKR ${val}`);
    }

    // Set Max Withdrawal
    if (text.startsWith('/setmaxwd ')) {
      const val = parseInt(text.replace('/setmaxwd ', ''));
      await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: val }, { upsert: true });
      return bot.sendMessage(chatId, `✅ Max withdrawal: PKR ${val}`);
    }

    // Set Daily Limit
    if (text.startsWith('/setdailywd ')) {
      const val = parseInt(text.replace('/setdailywd ', ''));
      await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: val }, { upsert: true });
      return bot.sendMessage(chatId, `✅ Daily limit: PKR ${val}`);
    }

    // Set Referral Bonus
    if (text.startsWith('/setrefbonus ')) {
      const val = parseFloat(text.replace('/setrefbonus ', ''));
      await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: val }, { upsert: true });
      return bot.sendMessage(chatId, `✅ Referral bonus: ${val}%`);
    }

    // Add FAQ
    if (text.startsWith('/addfaq ')) {
      const parts = text.replace('/addfaq ', '').split('|').map(s => s.trim());
      if (parts.length < 2) return bot.sendMessage(chatId, '❌ /addfaq Q | A');
      const count = await FAQ.countDocuments();
      await new FAQ({ question: parts[0], answer: parts[1], order: count + 1 }).save();
      return bot.sendMessage(chatId, '✅ FAQ added!');
    }

    // Delete FAQ
    if (text.startsWith('/delfaq ')) {
      const num = parseInt(text.replace('/delfaq ', ''));
      const faqs = await FAQ.find().sort({ order: 1 });
      if (num > 0 && num <= faqs.length) {
        await FAQ.findByIdAndDelete(faqs[num - 1]._id);
        return bot.sendMessage(chatId, `✅ FAQ #${num} deleted!`);
      }
      return bot.sendMessage(chatId, '❌ Invalid number');
    }

    // Clear FAQs
    if (text === '/clearfaqs') {
      await FAQ.deleteMany({});
      return bot.sendMessage(chatId, '✅ All FAQs deleted!');
    }

    // User Info
    if (text.startsWith('/user ')) {
      const username = text.replace('/user ', '').trim();
      const user = await User.findOne({ username });
      if (!user) return bot.sendMessage(chatId, '❌ User not found');

      const activePlan = user.activePlan?.planId ? `${user.activePlan.name} (${user.activePlan.profitDays}/60)` : 'None';
      const userInfoMsg = `👤 *${user.username}*\n\n` +
        `📱 ${user.whatsapp}\n` +
        `💰 Balance: PKR ${user.balance?.toFixed(2) || 0}\n` +
        `📊 Status: ${user.status}\n` +
        `📋 Plan: ${activePlan}\n` +
        `💵 Invested: PKR ${user.totalInvested || 0}\n` +
        `💎 Earned: PKR ${user.totalEarned || 0}\n` +
        `🔗 Referrals: ${await User.countDocuments({ referredBy: user.referralCode })}\n` +
        `📅 Joined: ${new Date(user.createdAt).toLocaleDateString()}`;

      const keyboard = {
        reply_markup: {
          inline_keyboard: [[
            { text: user.status === 'active' ? '🔴 Block' : '🟢 Unblock', callback_data: `u_toggle_${user.username}` }
          ]]
        }
      };

      return bot.sendMessage(chatId, userInfoMsg, { parse_mode: 'Markdown', ...keyboard });
    }

    // Toggle User
    if (msg.text && msg.text.startsWith('/')) return; // ignore other commands
  });

  // Toggle User Callback
  bot.on('callback_query', async (query) => {
    if (query.data.startsWith('u_toggle_')) {
      const username = query.data.split('_')[2];
      const user = await User.findOne({ username });
      if (user) {
        user.status = user.status === 'active' ? 'blocked' : 'active';
        await user.save();
        bot.sendMessage(query.message.chat.id, `✅ ${username} is now ${user.status}`);
      }
      await bot.answerCallbackQuery(query.id);
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
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ API ROUTES ============
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/signup', async (req, res) => {
  try {
    const { username, whatsapp, password, referralCode } = req.body;
    if (!username || !whatsapp || !password) return res.status(400).json({ error: 'All fields required' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username exists' });

    const user = new User({
      username,
      whatsapp,
      password: await bcrypt.hash(password, 10),
      referralCode: Math.random().toString(36).substring(2, 10).toUpperCase(),
      referredBy: referralCode || null
    });
    await user.save();

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
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = new Date(); today.setHours(0,0,0,0);
    const todayProfit = await Transaction.aggregate([
      { $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      username: user.username,
      balance: user.balance || 0,
      activePlan: user.activePlan || null,
      totalInvested: user.totalInvested || 0,
      totalEarned: user.totalEarned || 0,
      referralEarnings: user.referralEarnings || 0,
      referralCount: await User.countDocuments({ referredBy: user.referralCode }),
      referralCode: user.referralCode,
      todayProfit: todayProfit[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plans', authMiddleware, async (req, res) => {
  const plans = await Plan.find({ isActive: true }).sort({ planId: 1 });
  res.json(plans);
});

app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  const epNum = await Setting.findOne({ key: 'easypaisaNumber' });
  const epTitle = await Setting.findOne({ key: 'easypaisaTitle' });
  const jcNum = await Setting.findOne({ key: 'jazzcashNumber' });
  const jcTitle = await Setting.findOne({ key: 'jazzcashTitle' });
  res.json({
    easypaisa: { number: epNum?.value || 'N/A', title: epTitle?.value || 'N/A' },
    jazzcash: { number: jcNum?.value || 'N/A', title: jcTitle?.value || 'N/A' }
  });
});

app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;
    if (!planId || !accountType || !txId || !req.file) return res.status(400).json({ error: 'All fields required' });

    const plan = await Plan.findOne({ planId: parseInt(planId) });
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const user = await User.findById(req.userId);
    await new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'deposit',
      amount: plan.amount,
      accountType,
      screenshot: req.file.path,
      txId,
      planId: plan.planId
    }).save();

    res.json({ message: 'Deposit submitted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;
    const user = await User.findById(req.userId);
    const wdAmount = parseFloat(amount);

    if (!user.activePlan?.planId) return res.status(400).json({ error: 'No active plan' });
    if (user.balance < wdAmount) return res.status(400).json({ error: 'Insufficient balance' });

    await new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'withdraw',
      amount: wdAmount,
      accountType,
      accountNumber,
      accountTitle
    }).save();

    res.json({ message: 'Withdrawal submitted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  const txns = await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  res.json(txns);
});

app.get('/api/deposits', authMiddleware, async (req, res) => {
  const deps = await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(20);
  res.json(deps);
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  const wds = await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(20);
  res.json(wds);
});

app.get('/api/team', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  const team = await User.find({ referredBy: user.referralCode }).select('username totalInvested createdAt').sort({ createdAt: -1 });
  res.json({ teamCount: team.length, team });
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  const topInvestors = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username totalInvested');
  const topReferrers = await User.aggregate([
    { $match: { status: 'active' } },
    { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'refs' } },
    { $project: { username: 1, count: { $size: '$refs' } } },
    { $sort: { count: -1 } }, { $limit: 10 }
  ]);
  res.json({ topInvestors, topReferrers });
});

app.get('/api/faqs', async (req, res) => {
  const faqs = await FAQ.find().sort({ order: 1 });
  res.json(faqs);
});

// ============ DAILY PROFIT CRON ============
cron.schedule('0 0 * * *', async () => {
  console.log('🕛 Daily profit...');
  const users = await User.find({ 'activePlan.planId': { $exists: true }, 'activePlan.endDate': { $gte: new Date() }, 'activePlan.profitDays': { $lt: 60 }, status: 'active' });
  let count = 0;
  for (const user of users) {
    user.balance += user.activePlan.dailyProfit;
    user.totalEarned += user.activePlan.dailyProfit;
    user.activePlan.profitDays += 1;
    await user.save();
    await new Transaction({ userId: user._id, username: user.username, type: 'profit', amount: user.activePlan.dailyProfit, status: 'approved' }).save();
    count++;
  }
  console.log(`✅ Profit sent to ${count} users`);
});

// ============ INIT DATA ============
async function initData() {
  if (await Plan.countDocuments() === 0) {
    await Plan.insertMany([
      { planId: 1, name: 'Starter', amount: 360 }, { planId: 2, name: 'Silver', amount: 860 },
      { planId: 3, name: 'Gold', amount: 1460 }, { planId: 4, name: 'Platinum', amount: 2660 },
      { planId: 5, name: 'Diamond', amount: 4260 }, { planId: 6, name: 'Ruby', amount: 6060 },
      { planId: 7, name: 'Emerald', amount: 9060 }, { planId: 8, name: 'Sapphire', amount: 14060 },
      { planId: 9, name: 'Titanium', amount: 21060 }, { planId: 10, name: 'Master', amount: 30000 },
      { planId: 11, name: 'Custom', amount: 50000 }
    ]);
  }
  if (await Setting.countDocuments() === 0) {
    await Setting.insertMany([
      { key: 'referralBonus', value: 11 }, { key: 'minWithdraw', value: 30 },
      { key: 'maxWithdraw', value: 500000 }, { key: 'maxDailyWithdraw', value: 100000 },
      { key: 'easypaisaNumber', value: '03001234567' }, { key: 'easypaisaTitle', value: 'Muhammad Ali' },
      { key: 'jazzcashNumber', value: '03009876543' }, { key: 'jazzcashTitle', value: 'Muhammad Ali' }
    ]);
  }
  if (await FAQ.countDocuments() === 0) {
    await FAQ.insertMany([
      { question: 'How to invest?', answer: 'Select plan, send payment, upload screenshot.', order: 1 },
      { question: 'When profit?', answer: 'First profit immediately, then daily at 12 AM.', order: 2 },
      { question: 'Min withdrawal?', answer: 'PKR 30 minimum.', order: 3 }
    ]);
  }
}

// ============ START ============
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/investment_db')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await initData();
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
  })
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });
