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

// ============ MODELS ============
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

// ============ TELEGRAM BOT SETUP ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

let bot = null;
if (BOT_TOKEN && BOT_TOKEN !== 'your_bot_token_here') {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('✅ Telegram Bot started');
} else {
  console.log('⚠️ Telegram Bot not configured');
}

// Bot session storage for multi-step operations
const botSessions = {};

// ============ MAIN ADMIN MENU ============
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
      inline_keyboard: [
        [{ text: '🔙 Back to Main Menu', callback_data: 'm_main' }]
      ]
    }
  };
}

// ============ BOT HANDLERS ============
if (bot) {
  // Start Command
  bot.onText(/\/start|\/admin/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) {
      return bot.sendMessage(chatId, '⛔ Unauthorized Access');
    }
    
    bot.sendMessage(chatId, 
      '🔐 *ADMIN PANEL*\n\n' +
      'Welcome! You have full control:\n\n' +
      '• Manage Users\n' +
      '• Approve/Reject Transactions\n' +
      '• Add/Edit/Delete Plans\n' +
      '• Change Settings\n' +
      '• Update Payment Accounts\n' +
      '• Manage FAQs\n' +
      '• Broadcast Messages\n' +
      '• And More...',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
  });

  // Callback Query Handler
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    if (chatId !== ADMIN_ID) return bot.answerCallbackQuery(query.id);

    const action = query.data;
    await bot.answerCallbackQuery(query.id);
    
    try {
      // ============ MAIN MENU ============
      if (action === 'm_main') {
        await bot.deleteMessage(chatId, query.message.message_id);
        bot.sendMessage(chatId, '🔐 *ADMIN PANEL*\n\nSelect an option:', { parse_mode: 'Markdown', ...getMainMenu() });
      }

      // ============ DASHBOARD ============
      else if (action === 'm_dash') {
        const totalUsers = await User.countDocuments();
        const activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true }, status: 'active' });
        const blockedUsers = await User.countDocuments({ status: 'blocked' });
        const pendingDeps = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
        const pendingWds = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
        
        const totalDeposits = await Transaction.aggregate([
          { $match: { type: 'deposit', status: 'approved' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalWithdrawals = await Transaction.aggregate([
          { $match: { type: 'withdraw', status: 'approved' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const todayProfit = await Transaction.aggregate([
          { $match: { type: 'profit', status: 'approved', createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const msg = `📊 *DASHBOARD STATISTICS*\n\n` +
          `👥 *Users*\n` +
          `  • Total: ${totalUsers}\n` +
          `  • Active Plans: ${activePlans}\n` +
          `  • Blocked: ${blockedUsers}\n\n` +
          `💰 *Finance*\n` +
          `  • Total Deposits: PKR ${totalDeposits[0]?.total?.toLocaleString() || 0}\n` +
          `  • Total Withdrawals: PKR ${totalWithdrawals[0]?.total?.toLocaleString() || 0}\n` +
          `  • Today's Profit: PKR ${todayProfit[0]?.total?.toLocaleString() || 0}\n` +
          `  • Profit Given: ${todayProfit[0]?.count || 0} times\n\n` +
          `⏳ *Pending*\n` +
          `  • Deposits: ${pendingDeps}\n` +
          `  • Withdrawals: ${pendingWds}`;

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ============ USERS MANAGEMENT ============
      else if (action === 'm_users') {
        const users = await User.find().sort({ createdAt: -1 }).limit(30);
        let msg = '👥 *ALL USERS*\n\n';
        
        users.forEach((u, i) => {
          const status = u.status === 'blocked' ? '🔴' : u.activePlan ? '🟢' : '🟡';
          msg += `${i+1}. ${status} ${u.username}\n`;
          msg += `   💰 Invested: PKR ${u.totalInvested || 0}\n`;
          msg += `   📅 Joined: ${new Date(u.createdAt).toLocaleDateString()}\n\n`;
        });

        msg += `\nTotal: ${await User.countDocuments()} users\n\n`;
        msg += `Reply with: /user <username> to manage a user`;

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // User Management Command
      bot.onText(/\/user (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;

        const username = match[1].trim();
        const user = await User.findOne({ username });

        if (!user) {
          return bot.sendMessage(chatId, '❌ User not found');
        }

        const activePlan = user.activePlan?.planId ? `Plan ${user.activePlan.name} (Day ${user.activePlan.profitDays}/60)` : 'None';
        const status = user.status === 'active' ? '🟢 Active' : '🔴 Blocked';

        const usermsg = `👤 *User: ${user.username}*\n\n` +
          `📱 WhatsApp: ${user.whatsapp}\n` +
          `💰 Balance: PKR ${user.balance?.toFixed(2) || 0}\n` +
          `📊 Status: ${status}\n` +
          `📋 Active Plan: ${activePlan}\n` +
          `💵 Total Invested: PKR ${user.totalInvested || 0}\n` +
          `💎 Total Earned: PKR ${user.totalEarned || 0}\n` +
          `🔗 Referrals: ${await User.countDocuments({ referredBy: user.referralCode })}\n` +
          `🎁 Referral Earnings: PKR ${user.referralEarnings || 0}\n` +
          `📅 Joined: ${new Date(user.createdAt).toLocaleDateString()}`;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: user.status === 'active' ? '🔴 Block User' : '🟢 Unblock User', callback_data: `u_toggle_${user.username}` },
                { text: '💰 Add Balance', callback_data: `u_addbal_${user.username}` }
              ],
              [
                { text: '❌ Delete User', callback_data: `u_delete_${user.username}` },
                { text: '📨 Message', callback_data: `u_msg_${user.username}` }
              ],
              [{ text: '🔙 Back', callback_data: 'm_users' }]
            ]
          }
        };

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
      });

      // ============ PENDING DEPOSITS ============
      else if (action === 'm_deps') {
        const deps = await Transaction.find({ type: 'deposit', status: 'pending' }).sort({ createdAt: -1 }).limit(10);

        if (deps.length === 0) {
          await bot.editMessageText('✅ *No Pending Deposits*', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
          return;
        }

        for (const dep of deps) {
          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `dep_approve_${dep._id}` },
                { text: '❌ Reject', callback_data: `dep_reject_${dep._id}` }
              ]]
            }
          };

          const msg = `💰 *PENDING DEPOSIT*\n\n` +
            `👤 User: ${dep.username}\n` +
            `📋 Plan ID: ${dep.planId}\n` +
            `💵 Amount: PKR ${dep.amount}\n` +
            `🏦 Method: ${dep.accountType}\n` +
            `🔢 TxID: ${dep.txId}\n` +
            `📅 Date: ${new Date(dep.createdAt).toLocaleString()}`;

          try {
            if (dep.screenshot && fs.existsSync(path.join(__dirname, dep.screenshot))) {
              await bot.sendPhoto(chatId, path.join(__dirname, dep.screenshot), { 
                caption: msg, 
                parse_mode: 'Markdown', 
                ...keyboard 
              });
            } else {
              await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
            }
          } catch (e) {
            await bot.sendMessage(chatId, msg + '\n\n⚠️ Screenshot not available', { parse_mode: 'Markdown', ...keyboard });
          }
        }
      }

      // ============ PENDING WITHDRAWALS ============
      else if (action === 'm_wds') {
        const wds = await Transaction.find({ type: 'withdraw', status: 'pending' }).sort({ createdAt: -1 }).limit(10);

        if (wds.length === 0) {
          await bot.editMessageText('✅ *No Pending Withdrawals*', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
          return;
        }

        for (const wd of wds) {
          const user = await User.findOne({ username: wd.username });
          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `wd_approve_${wd._id}` },
                { text: '❌ Reject', callback_data: `wd_reject_${wd._id}` }
              ]]
            }
          };

          const msg = `💸 *PENDING WITHDRAWAL*\n\n` +
            `👤 User: ${wd.username}\n` +
            `💰 Balance: PKR ${user?.balance?.toFixed(2) || 0}\n` +
            `💵 Amount: PKR ${wd.amount}\n` +
            `🏦 Method: ${wd.accountType}\n` +
            `🔢 Account: ${wd.accountNumber}\n` +
            `📛 Title: ${wd.accountTitle}\n` +
            `📅 Date: ${new Date(wd.createdAt).toLocaleString()}`;

          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...keyboard });
        }
      }

      // ============ MANAGE PLANS ============
      else if (action === 'm_plans') {
        const plans = await Plan.find().sort({ planId: 1 });
        let msg = '📋 *ALL INVESTMENT PLANS*\n\n';

        plans.forEach(p => {
          const status = p.isActive ? '✅' : '❌';
          const totalReturn = p.amount * (p.dailyProfit / 100) * p.duration;
          msg += `${status} *Plan ${p.planId}: ${p.name}*\n`;
          msg += `  💰 Amount: PKR ${p.amount}\n`;
          msg += `  📈 Profit: ${p.dailyProfit}% daily\n`;
          msg += `  📅 Duration: ${p.duration} days\n`;
          msg += `  💎 Return: PKR ${totalReturn.toFixed(0)}\n\n`;
        });

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add New Plan', callback_data: 'p_add' }],
              [{ text: '✏️ Edit Plan', callback_data: 'p_edit_select' }],
              [{ text: '❌ Delete Plan', callback_data: 'p_delete_select' }],
              [{ text: '🔙 Back to Menu', callback_data: 'm_main' }]
            ]
          }
        };

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...keyboard });
      }

      // Plan: Select to Edit
      else if (action === 'p_edit_select') {
        const plans = await Plan.find().sort({ planId: 1 });
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              ...plans.map(p => [{ text: `✏️ Plan ${p.planId}: ${p.name}`, callback_data: `p_edit_${p.planId}` }]),
              [{ text: '🔙 Back', callback_data: 'm_plans' }]
            ]
          }
        };
        await bot.editMessageText('Select a plan to edit:', { chat_id: chatId, message_id: query.message.message_id, ...keyboard });
      }

      // Plan: Select to Delete
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
        await bot.editMessageText('Select a plan to delete:', { chat_id: chatId, message_id: query.message.message_id, ...keyboard });
      }

      // Add New Plan
      else if (action === 'p_add') {
        botSessions[chatId] = { action: 'adding_plan', step: 1, data: {} };
        await bot.sendMessage(chatId, '➕ *ADD NEW PLAN*\n\nReply with plan details in this format:\n`Name | Amount | DailyProfit% | DurationDays`\n\nExample: `Premium | 5000 | 11 | 60`', { parse_mode: 'Markdown' });
      }

      // Edit Plan
      else if (action.startsWith('p_edit_')) {
        const planId = parseInt(action.split('_')[2]);
        const plan = await Plan.findOne({ planId });
        if (!plan) return bot.sendMessage(chatId, '❌ Plan not found');

        botSessions[chatId] = { action: 'editing_plan', step: 1, planId, data: {} };
        await bot.sendMessage(chatId, `✏️ *EDIT PLAN ${planId}*\n\nCurrent: ${plan.name} | PKR ${plan.amount} | ${plan.dailyProfit}% | ${plan.duration} Days\n\nReply with new details:\n\`Name | Amount | DailyProfit% | DurationDays\`\n\nOr send /cancel`, { parse_mode: 'Markdown' });
      }

      // Delete Plan
      else if (action.startsWith('p_delete_')) {
        const planId = parseInt(action.split('_')[2]);
        const plan = await Plan.findOne({ planId });
        if (!plan) return bot.sendMessage(chatId, '❌ Plan not found');

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Yes, Delete', callback_data: `p_delete_confirm_${planId}` },
                { text: '❌ Cancel', callback_data: 'm_plans' }
              ]
            ]
          }
        };

        await bot.sendMessage(chatId, `🗑️ *DELETE PLAN ${planId}*\n\nAre you sure?\nPlan: ${plan.name}\nAmount: PKR ${plan.amount}`, { parse_mode: 'Markdown', ...keyboard });
      }

      // Confirm Delete Plan
      else if (action.startsWith('p_delete_confirm_')) {
        const planId = parseInt(action.split('_')[3]);
        await Plan.deleteOne({ planId });
        await bot.sendMessage(chatId, `✅ Plan ${planId} deleted successfully!`, { ...getBackButton('m_plans') });
      }

      // Toggle Plan Active/Inactive
      else if (action.startsWith('p_toggle_')) {
        const planId = parseInt(action.split('_')[2]);
        const plan = await Plan.findOne({ planId });
        if (plan) {
          plan.isActive = !plan.isActive;
          await plan.save();
          await bot.sendMessage(chatId, `✅ Plan ${planId} is now ${plan.isActive ? 'Active ✅' : 'Inactive ❌'}`, { ...getBackButton('m_plans') });
        }
      }

      // ============ PAYMENT ACCOUNTS ============
      else if (action === 'm_accounts') {
        const epNum = await Setting.findOne({ key: 'easypaisaNumber' });
        const epTitle = await Setting.findOne({ key: 'easypaisaTitle' });
        const jcNum = await Setting.findOne({ key: 'jazzcashNumber' });
        const jcTitle = await Setting.findOne({ key: 'jazzcashTitle' });

        const msg = `🏦 *PAYMENT ACCOUNTS*\n\n` +
          `*Easypaisa:*\n` +
          `  📱 Number: ${epNum?.value || 'Not set'}\n` +
          `  📛 Title: ${epTitle?.value || 'Not set'}\n\n` +
          `*JazzCash:*\n` +
          `  📱 Number: ${jcNum?.value || 'Not set'}\n` +
          `  📛 Title: ${jcTitle?.value || 'Not set'}\n\n` +
          `To change, use:\n` +
          `/setep <number> | <title>\n` +
          `/setjc <number> | <title>`;

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // Set Easypaisa
      bot.onText(/\/setep (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;

        const parts = match[1].split('|').map(s => s.trim());
        if (parts.length < 2) return bot.sendMessage(chatId, '❌ Format: /setep <number> | <title>');

        await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: parts[0] }, { upsert: true });
        await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: parts[1] }, { upsert: true });

        bot.sendMessage(chatId, `✅ Easypaisa updated:\nNumber: ${parts[0]}\nTitle: ${parts[1]}`);
      });

      // Set JazzCash
      bot.onText(/\/setjc (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;

        const parts = match[1].split('|').map(s => s.trim());
        if (parts.length < 2) return bot.sendMessage(chatId, '❌ Format: /setjc <number> | <title>');

        await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: parts[0] }, { upsert: true });
        await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: parts[1] }, { upsert: true });

        bot.sendMessage(chatId, `✅ JazzCash updated:\nNumber: ${parts[0]}\nTitle: ${parts[1]}`);
      });

      // ============ SETTINGS ============
      else if (action === 'm_settings') {
        const settings = await Setting.find({});
        let msg = '⚙️ *SYSTEM SETTINGS*\n\n';

        settings.forEach(s => {
          msg += `• ${s.key}: ${s.value}\n`;
        });

        msg += '\nCommands to change:\n';
        msg += '/setminwd <amount> - Min Withdrawal\n';
        msg += '/setmaxwd <amount> - Max Withdrawal\n';
        msg += '/setdailywd <amount> - Daily Limit\n';
        msg += '/setrefbonus <percent> - Referral Bonus %\n';

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // Setting Commands
      bot.onText(/\/setminwd (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        const val = parseInt(match[1]);
        await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: val }, { upsert: true });
        bot.sendMessage(chatId, `✅ Minimum withdrawal set to PKR ${val}`);
      });

      bot.onText(/\/setmaxwd (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        const val = parseInt(match[1]);
        await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: val }, { upsert: true });
        bot.sendMessage(chatId, `✅ Maximum withdrawal set to PKR ${val}`);
      });

      bot.onText(/\/setdailywd (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        const val = parseInt(match[1]);
        await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: val }, { upsert: true });
        bot.sendMessage(chatId, `✅ Daily withdrawal limit set to PKR ${val}`);
      });

      bot.onText(/\/setrefbonus (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        const val = parseFloat(match[1]);
        await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: val }, { upsert: true });
        bot.sendMessage(chatId, `✅ Referral bonus set to ${val}%`);
      });

      // ============ REFERRAL SETTINGS ============
      else if (action === 'm_referral') {
        const bonus = await Setting.findOne({ key: 'referralBonus' });
        const msg = `🔗 *REFERRAL SETTINGS*\n\n` +
          `Current Bonus: ${bonus?.value || 11}%\n\n` +
          `Change with: /setrefbonus <percent>\n` +
          `Example: /setrefbonus 15`;

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      // ============ FAQ MANAGEMENT ============
      else if (action === 'm_faq') {
        const faqs = await FAQ.find().sort({ order: 1 });
        let msg = '❓ *FAQ MANAGEMENT*\n\n';
        
        if (faqs.length === 0) {
          msg += 'No FAQs yet.\n\n';
        } else {
          faqs.forEach((f, i) => {
            msg += `${i+1}. *Q:* ${f.question}\n   *A:* ${f.answer}\n\n`;
          });
        }

        msg += 'Commands:\n';
        msg += '/addfaq <question> | <answer>\n';
        msg += '/delfaq <number>\n';
        msg += '/clearfaqs - Delete all FAQs';

        await bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getBackButton('m_main') });
      }

      bot.onText(/\/addfaq (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        
        const parts = match[1].split('|').map(s => s.trim());
        if (parts.length < 2) return bot.sendMessage(chatId, '❌ Format: /addfaq <question> | <answer>');

        const count = await FAQ.countDocuments();
        await new FAQ({ question: parts[0], answer: parts[1], order: count + 1 }).save();
        bot.sendMessage(chatId, '✅ FAQ added successfully!');
      });

      bot.onText(/\/delfaq (.+)/, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        
        const num = parseInt(match[1]);
        const faqs = await FAQ.find().sort({ order: 1 });
        if (num > 0 && num <= faqs.length) {
          await FAQ.findByIdAndDelete(faqs[num - 1]._id);
          bot.sendMessage(chatId, `✅ FAQ #${num} deleted!`);
        } else {
          bot.sendMessage(chatId, '❌ Invalid FAQ number');
        }
      });

      bot.onText(/\/clearfaqs/, async (msg) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== ADMIN_ID) return;
        await FAQ.deleteMany({});
        bot.sendMessage(chatId, '✅ All FAQs deleted!');
      });

      // ============ BROADCAST ============
      else if (action === 'm_broadcast') {
        botSessions[chatId] = { action: 'broadcast' };
        await bot.sendMessage(chatId, '📢 *BROADCAST MESSAGE*\n\nSend the message you want to broadcast to all users.\n\nSend /cancel to abort.', { parse_mode: 'Markdown' });
      }

      // ============ USER ACTIONS ============
      // Toggle Block/Unblock
      else if (action.startsWith('u_toggle_')) {
        const username = action.split('_')[2];
        const user = await User.findOne({ username });
        if (user) {
          user.status = user.status === 'active' ? 'blocked' : 'active';
          await user.save();
          bot.sendMessage(chatId, `✅ User ${username} is now ${user.status}`);
        }
      }

      // ============ DEPOSIT APPROVE/REJECT ============
      else if (action.startsWith('dep_approve_')) {
        const tid = action.split('_')[2];
        await handleDepositAction(tid, 'approved', chatId);
      }
      else if (action.startsWith('dep_reject_')) {
        const tid = action.split('_')[2];
        await handleDepositAction(tid, 'rejected', chatId);
      }

      // ============ WITHDRAWAL APPROVE/REJECT ============
      else if (action.startsWith('wd_approve_')) {
        const tid = action.split('_')[2];
        await handleWithdrawalAction(tid, 'approved', chatId);
      }
      else if (action.startsWith('wd_reject_')) {
        const tid = action.split('_')[2];
        await handleWithdrawalAction(tid, 'rejected', chatId);
      }

    } catch (err) {
      console.error('Bot error:', err.message);
      bot.sendMessage(chatId, '❌ Error: ' + err.message);
    }
  });

  // Handle text replies for multi-step operations
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID || !msg.text || msg.text.startsWith('/')) return;

    const session = botSessions[chatId];
    if (!session) return;

    // Cancel
    if (msg.text === '/cancel') {
      delete botSessions[chatId];
      return bot.sendMessage(chatId, '❌ Operation cancelled', getMainMenu());
    }

    // Add/Edit Plan
    if (session.action === 'adding_plan' || session.action === 'editing_plan') {
      const parts = msg.text.split('|').map(s => s.trim());
      if (parts.length < 4) {
        return bot.sendMessage(chatId, '❌ Invalid format!\nUse: Name | Amount | DailyProfit% | DurationDays\nExample: Premium | 5000 | 11 | 60');
      }

      const [name, amount, dailyProfit, duration] = parts;

      if (session.action === 'adding_plan') {
        const lastPlan = await Plan.findOne().sort({ planId: -1 });
        const newPlanId = lastPlan ? lastPlan.planId + 1 : 1;
        
        await new Plan({
          planId: newPlanId,
          name,
          amount: parseInt(amount),
          dailyProfit: parseFloat(dailyProfit),
          duration: parseInt(duration)
        }).save();

        bot.sendMessage(chatId, `✅ New plan added!\nPlan ${newPlanId}: ${name}\nAmount: PKR ${amount}\nProfit: ${dailyProfit}%\nDuration: ${duration} days`, getMainMenu());
      } else {
        await Plan.findOneAndUpdate(
          { planId: session.planId },
          { name, amount: parseInt(amount), dailyProfit: parseFloat(dailyProfit), duration: parseInt(duration) }
        );

        bot.sendMessage(chatId, `✅ Plan ${session.planId} updated!\n${name} | PKR ${amount} | ${dailyProfit}% | ${duration} days`, getMainMenu());
      }

      delete botSessions[chatId];
      return;
    }

    // Broadcast
    if (session.action === 'broadcast') {
      const users = await User.find({ status: 'active' });
      let sent = 0;

      for (const user of users) {
        try {
          await bot.sendMessage(user._id, `📢 *Message from Admin*\n\n${msg.text}`, { parse_mode: 'Markdown' });
          sent++;
        } catch (e) {
          // User may not have started the bot
        }
      }

      bot.sendMessage(chatId, `✅ Broadcast sent to ${sent}/${users.length} users`, getMainMenu());
      delete botSessions[chatId];
      return;
    }
  });
}

// Helper Functions
async function handleDepositAction(tid, status, chatId) {
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

          bot.sendMessage(chatId, `🎁 Referral bonus of PKR ${bonus} given to ${referrer.username}`);
        }
      }
    }
  }

  bot.sendMessage(chatId, `✅ Deposit ${status}!\nUser: ${transaction.username}\nAmount: PKR ${transaction.amount}`);
}

async function handleWithdrawalAction(tid, status, chatId) {
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

// ============ API ROUTES ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

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

    if (referralCode && bot && ADMIN_ID) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        bot.sendMessage(ADMIN_ID, `🔗 <b>New Referral!</b>\n${username} joined via ${referrer.username}'s link`, { parse_mode: 'HTML' });
      }
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, referralCode: newReferralCode });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
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

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayProfit = await Transaction.aggregate([
      { $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } },
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
    res.status(500).json({ error: 'Error loading dashboard' });
  }
});

app.get('/api/plans', authMiddleware, async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ planId: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Error loading plans' });
  }
});

app.get('/api/deposit-accounts', authMiddleware, async (req, res) => {
  try {
    const epNum = await Setting.findOne({ key: 'easypaisaNumber' });
    const epTitle = await Setting.findOne({ key: 'easypaisaTitle' });
    const jcNum = await Setting.findOne({ key: 'jazzcashNumber' });
    const jcTitle = await Setting.findOne({ key: 'jazzcashTitle' });

    res.json({
      easypaisa: { number: epNum?.value || '03000000000', title: epTitle?.value || 'Account Title' },
      jazzcash: { number: jcNum?.value || '03000000000', title: jcTitle?.value || 'Account Title' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error loading accounts' });
  }
});

app.post('/api/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  try {
    const { planId, accountType, txId } = req.body;
    if (!planId || !accountType || !txId || !req.file) {
      return res.status(400).json({ error: 'All fields including screenshot are required' });
    }

    const plan = await Plan.findOne({ planId: parseInt(planId) });
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const user = await User.findById(req.userId);
    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'deposit',
      amount: plan.amount,
      accountType,
      screenshot: req.file.path,
      txId,
      planId: plan.planId
    });

    await transaction.save();

    if (bot && ADMIN_ID) {
      const msg = `💰 <b>New Deposit</b>\n\n👤 ${user.username}\n📋 ${plan.name}\n💵 PKR ${plan.amount}\n🔢 ${txId}\n🏦 ${accountType}\n📅 ${new Date().toLocaleString()}`;
      await bot.sendMessage(ADMIN_ID, msg, { parse_mode: 'HTML' });
      await bot.sendPhoto(ADMIN_ID, req.file.path, { caption: '📸 Payment Screenshot' });
    }

    res.json({ message: 'Deposit submitted! Waiting for approval.' });
  } catch (err) {
    res.status(500).json({ error: 'Deposit failed' });
  }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { accountType, accountNumber, accountTitle, amount } = req.body;
    const user = await User.findById(req.userId);

    if (!user.activePlan?.planId) return res.status(400).json({ error: 'No active plan. Invest first.' });

    const withdrawAmount = parseFloat(amount);
    if (!withdrawAmount || withdrawAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const minWD = await Setting.findOne({ key: 'minWithdraw' });
    const maxWD = await Setting.findOne({ key: 'maxWithdraw' });
    const dailyMax = await Setting.findOne({ key: 'maxDailyWithdraw' });

    if (withdrawAmount < (minWD?.value || 30)) return res.status(400).json({ error: `Min: PKR ${minWD?.value || 30}` });
    if (withdrawAmount > (maxWD?.value || 500000)) return res.status(400).json({ error: `Max: PKR ${maxWD?.value || 500000}` });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dailyTotal = await Transaction.aggregate([
      { $match: { userId: user._id, type: 'withdraw', status: { $ne: 'rejected' }, createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    if (dailyTotal[0]?.total + withdrawAmount > (dailyMax?.value || 100000)) {
      return res.status(400).json({ error: 'Daily limit exceeded' });
    }

    if (user.balance < withdrawAmount) return res.status(400).json({ error: 'Insufficient balance' });

    const transaction = new Transaction({
      userId: req.userId,
      username: user.username,
      type: 'withdraw',
      amount: withdrawAmount,
      accountType,
      accountNumber,
      accountTitle
    });

    await transaction.save();

    if (bot && ADMIN_ID) {
      bot.sendMessage(ADMIN_ID, `💸 <b>New Withdrawal</b>\n\n👤 ${user.username}\n💵 PKR ${withdrawAmount}\n🏦 ${accountType}\n🔢 ${accountNumber}\n📛 ${accountTitle}`, { parse_mode: 'HTML' });
    }

    res.json({ message: 'Withdrawal request submitted!' });
  } catch (err) {
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  res.json(transactions);
});

app.get('/api/deposits', authMiddleware, async (req, res) => {
  const deposits = await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(20);
  res.json(deposits);
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  const withdrawals = await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(20);
  res.json(withdrawals);
});

app.get('/api/team', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  const team = await User.find({ referredBy: user.referralCode }).select('username totalInvested totalEarned createdAt').sort({ createdAt: -1 });
  res.json({ teamCount: team.length, team });
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  const topInvestors = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username totalInvested');
  const topReferrers = await User.aggregate([
    { $match: { status: 'active' } },
    { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'refs' } },
    { $project: { username: 1, count: { $size: '$refs' } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);
  res.json({ topInvestors, topReferrers });
});

app.get('/api/faqs', async (req, res) => {
  const faqs = await FAQ.find().sort({ order: 1 });
  res.json(faqs);
});

// ============ DAILY PROFIT CRON ============
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

// ============ INIT DATA ============
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
      { question: 'How to invest?', answer: 'Select a plan, send payment, upload screenshot with Transaction ID.', order: 1 },
      { question: 'When do I get profit?', answer: 'First profit immediately after approval, then daily at 12:00 AM.', order: 2 },
      { question: 'Minimum withdrawal?', answer: 'PKR 30 minimum withdrawal.', order: 3 }
    ]);
  }
}

// ============ START SERVER ============
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/investment_db')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await initData();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });
