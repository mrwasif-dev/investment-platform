// ============================================================
// PROFIT 24 - COMPLETE BACKEND SERVER v10
// Investment Platform with Telegram Bot Admin Panel
// Features: User Auth, PID System, 11 Plans, Deposit/Withdraw,
// Fund Transfer, Referral System, Daily Profit Cron,
// Telegram Bot (All Buttons, No Commands), URDU AI Chatbot
// ============================================================

require('dotenv').config();

// ================================================================
// IMPORT ALL DEPENDENCIES
// ================================================================
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

// ================================================================
// APP INITIALIZATION
// ================================================================
const app = express();
const PORT = process.env.PORT || 5000;

// ================================================================
// CREATE REQUIRED DIRECTORIES
// ================================================================
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });
if (!fs.existsSync('public/css')) fs.mkdirSync('public/css', { recursive: true });
if (!fs.existsSync('public/js')) fs.mkdirSync('public/js', { recursive: true });

// ================================================================
// MIDDLEWARE SETUP
// ================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ================================================================
// MULTER CONFIGURATION FOR FILE UPLOADS
// ================================================================

const depositStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        cb(null, 'dep-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const uploadDeposit = multer({ storage: depositStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const profileStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/'); },
    filename: function (req, file, cb) {
        cb(null, 'dp-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const uploadProfile = multer({ storage: profileStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ================================================================
// MONGODB SCHEMAS
// ================================================================

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, trim: true, lowercase: true },
    whatsapp: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    pid: { type: String, unique: true, required: true },
    profilePic: { type: String, default: null },
    balance: { type: Number, default: 0, min: 0 },
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
    totalWithdrawn: { type: Number, default: 0 },
    pendingWithdrawal: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    type: { type: String, enum: ['deposit', 'withdraw', 'profit', 'referral', 'transfer_sent', 'transfer_received', 'refund'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed', 'refunded'], default: 'pending' },
    accountType: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    accountTitle: { type: String, default: '' },
    screenshot: { type: String, default: null },
    txId: { type: String, default: '' },
    planId: { type: Number, default: null },
    planName: { type: String, default: '' },
    relatedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    relatedUsername: { type: String, default: '' },
    fee: { type: Number, default: 0 },
    refundAt: { type: Date, default: null },
    telegramMsgId: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null }
});

const planSchema = new mongoose.Schema({
    planId: { type: Number, unique: true, required: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    dailyProfit: { type: Number, default: 11 },
    duration: { type: Number, default: 60 },
    isActive: { type: Boolean, default: true }
});

const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

const faqSchema = new mongoose.Schema({
    question: { type: String, required: true },
    answer: { type: String, required: true },
    order: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// ================================================================
// PID GENERATOR
// ================================================================
function generatePID(whatsapp) {
    var cleaned = whatsapp.replace(/[\s\-\+\(\)]/g, '');
    if (cleaned.length >= 5) return cleaned.slice(-5);
    return cleaned.padStart(5, '0');
}

// ================================================================
// TELEGRAM BOT - FULL ADMIN PANEL
// ================================================================
var bot = null;
var botSessions = {};

function initTelegramBot() {
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var adminId = process.env.TELEGRAM_ADMIN_ID;

    if (!botToken || !adminId) {
        console.log('⚠️ Telegram Bot: Not configured');
        return;
    }

    try {
        bot = new TelegramBot(botToken, { polling: true });
        console.log('✅ Telegram Bot: Connected');
    } catch (error) {
        console.error('❌ Telegram Bot Error:', error.message);
        return;
    }

    function getMainMenuKeyboard() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard', callback_data: 'admin_dashboard' }],
                    [{ text: '👥 Users List', callback_data: 'admin_users' }],
                    [{ text: '💰 Pending Deposits', callback_data: 'admin_deposits' }],
                    [{ text: '💸 Pending Withdrawals', callback_data: 'admin_withdrawals' }],
                    [{ text: '📋 Manage Plans', callback_data: 'admin_plans' }],
                    [{ text: '🔄 Fund Transfer Settings', callback_data: 'admin_fundtransfer' }],
                    [{ text: '🏦 Payment Accounts', callback_data: 'admin_accounts' }],
                    [{ text: '⚙️ System Settings', callback_data: 'admin_settings' }],
                    [{ text: '🔗 Referral Settings', callback_data: 'admin_referral' }],
                    [{ text: '❓ FAQ Management', callback_data: 'admin_faq' }],
                    [{ text: '📢 Broadcast Message', callback_data: 'admin_broadcast' }],
                    [{ text: '🔍 Search User', callback_data: 'admin_search' }]
                ]
            }
        };
    }

    bot.onText(/\/start|\/admin/, function (msg) {
        var chatId = msg.chat.id.toString();
        if (chatId !== adminId) return;
        bot.sendMessage(adminId, '🔐 *ADMIN PANEL*\n\nAll controls via buttons:', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
    });

    bot.on('callback_query', async function (query) {
        var chatId = query.message.chat.id.toString();
        if (chatId !== adminId) return bot.answerCallbackQuery(query.id);
        var action = query.data;
        await bot.answerCallbackQuery(query.id);

        try {
            if (action === 'admin_dashboard') {
                var totalUsers = await User.countDocuments();
                var activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true }, status: 'active' });
                var pendingDeposits = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
                var pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
                var totalDepositsResult = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
                var today = new Date(); today.setHours(0, 0, 0, 0);
                var todayProfitResult = await Transaction.aggregate([{ $match: { type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]);
                var depositEnabled = await Setting.findOne({ key: 'depositEnabled' });
                var withdrawEnabled = await Setting.findOne({ key: 'withdrawEnabled' });
                var transferEnabled = await Setting.findOne({ key: 'fundTransferEnabled' });
                var transferFee = await Setting.findOne({ key: 'fundTransferFee' });

                var dashboardMessage = '📊 *DASHBOARD*\n\n' +
                    '👥 Users: ' + totalUsers + ' | Active Plans: ' + activePlans + '\n' +
                    '⏳ Pending Dep: ' + pendingDeposits + ' | WD: ' + pendingWithdrawals + '\n' +
                    '💰 Total Dep: PKR ' + (totalDepositsResult[0]?.total || 0).toLocaleString() + '\n' +
                    '💎 Today Profit: PKR ' + (todayProfitResult[0]?.total || 0).toLocaleString() + ' (' + (todayProfitResult[0]?.count || 0) + 'x)\n\n' +
                    '⚙️ Deposit: ' + (depositEnabled?.value !== false ? '✅' : '❌') + ' | Withdraw: ' + (withdrawEnabled?.value !== false ? '✅' : '❌') + ' | Transfer: ' + (transferEnabled?.value !== false ? '✅' : '❌') + ' | Fee: ' + (transferFee?.value || 0) + '%';

                await bot.editMessageText(dashboardMessage, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getMainMenuKeyboard() });
            }

            else if (action === 'admin_users') {
                var users = await User.find().sort({ createdAt: -1 }).limit(25).lean();
                var message = '👥 *USERS (' + (await User.countDocuments()) + ')*\n\n';
                users.forEach(function (u, i) {
                    message += (i + 1) + '. ' + (u.status === 'blocked' ? '🔴' : '🟢') + ' ' + u.username + ' | PID:' + u.pid + ' | PKR ' + (u.balance || 0).toFixed(2) + '\n';
                });
                message += '\nUse Search to find user';
                await bot.editMessageText(message, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...getMainMenuKeyboard() });
            }

            else if (action === 'admin_deposits') {
                await showPendingTransactions('deposit', chatId, query.message.message_id);
            }

            else if (action === 'admin_withdrawals') {
                await showPendingTransactions('withdraw', chatId, query.message.message_id);
            }

            else if (action === 'admin_plans') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();
                var message = '📋 *PLANS*\n\n';
                plans.forEach(function (p) {
                    var tr = p.amount * (p.dailyProfit / 100) * p.duration;
                    message += (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name + ' | PKR ' + p.amount.toLocaleString() + ' | ' + p.dailyProfit + '% | ' + p.duration + 'd\n   💎 Return: PKR ' + tr.toLocaleString() + '\n\n';
                });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add Plan', callback_data: 'plan_add' }, { text: '🗑️ Delete Plan', callback_data: 'plan_delete_select' }], [{ text: '🔄 Toggle Plan', callback_data: 'plan_toggle_select' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(message, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }

            else if (action === 'plan_add') { botSessions[chatId] = { step: 'adding_plan' }; await bot.sendMessage(chatId, '➕ Send: Name | Amount | Profit% | Days\nExample: Premium | 5000 | 12 | 60\n\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'plan_delete_select') { var plans = await Plan.find().sort({ planId: 1 }).lean(); var btns = plans.map(function (p) { return [{ text: '🗑️ ' + p.planId + '. ' + p.name, callback_data: 'plan_delete_' + p.planId }]; }); btns.push([{ text: '🔙 Back', callback_data: 'admin_plans' }]); await bot.editMessageText('Delete plan:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: btns } }); }
            else if (action === 'plan_toggle_select') { var plans = await Plan.find().sort({ planId: 1 }).lean(); var btns = plans.map(function (p) { return [{ text: (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name, callback_data: 'plan_toggle_' + p.planId }]; }); btns.push([{ text: '🔙 Back', callback_data: 'admin_plans' }]); await bot.editMessageText('Toggle plan:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: btns } }); }
            else if (action.startsWith('plan_delete_')) { var pid = parseInt(action.replace('plan_delete_', '')); await Plan.deleteOne({ planId: pid }); await bot.sendMessage(chatId, '✅ Plan deleted!', getMainMenuKeyboard()); }
            else if (action.startsWith('plan_toggle_')) { var pid = parseInt(action.replace('plan_toggle_', '')); var p = await Plan.findOne({ planId: pid }); if (p) { p.isActive = !p.isActive; await p.save(); } await bot.sendMessage(chatId, '✅ Toggled!', getMainMenuKeyboard()); }

            else if (action === 'admin_fundtransfer') {
                var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
                var fee = await Setting.findOne({ key: 'fundTransferFee' });
                var m = '🔄 *FUND TRANSFER*\n\nStatus: ' + (fte?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\nFee: ' + (fee?.value || 0) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: (fte?.value !== false ? '❌ Disable' : '✅ Enable'), callback_data: 'ft_toggle' }], [{ text: '💰 Set Fee %', callback_data: 'ft_setfee' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(m, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'ft_toggle') { var cur = await Setting.findOne({ key: 'fundTransferEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'fundTransferEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(chatId, '✅ Transfer ' + (nv ? 'Enabled' : 'Disabled'), getMainMenuKeyboard()); }
            else if (action === 'ft_setfee') { botSessions[chatId] = { step: 'setting_transfer_fee' }; await bot.sendMessage(chatId, '💰 Send fee % (0-100):\n/cancel', { parse_mode: 'Markdown' }); }

            else if (action === 'admin_accounts') {
                var ep = await Setting.findOne({ key: 'easypaisaNumber' }), jc = await Setting.findOne({ key: 'jazzcashNumber' });
                var m = '🏦 *ACCOUNTS*\n\nEasypaisa: ' + (ep?.value || 'N/A') + '\nJazzCash: ' + (jc?.value || 'N/A');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📱 Update Easypaisa', callback_data: 'acc_setep' }], [{ text: '💼 Update JazzCash', callback_data: 'acc_setjc' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(m, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'acc_setep') { botSessions[chatId] = { step: 'setting_easypaisa' }; await bot.sendMessage(chatId, '📱 Send: Number | Title\nExample: 03001234567 | Ali\n\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'acc_setjc') { botSessions[chatId] = { step: 'setting_jazzcash' }; await bot.sendMessage(chatId, '💼 Send: Number | Title\nExample: 03009876543 | Ali\n\n/cancel', { parse_mode: 'Markdown' }); }

            else if (action === 'admin_settings') {
                var mi = await Setting.findOne({ key: 'minWithdraw' }), ma = await Setting.findOne({ key: 'maxWithdraw' }), da = await Setting.findOne({ key: 'maxDailyWithdraw' });
                var de = await Setting.findOne({ key: 'depositEnabled' }), we = await Setting.findOne({ key: 'withdrawEnabled' });
                var m = '⚙️ *SETTINGS*\n\nMin WD: PKR ' + (mi?.value || 30).toLocaleString() + '\nMax WD: PKR ' + (ma?.value || 500000).toLocaleString() + '\nDaily: PKR ' + (da?.value || 100000).toLocaleString() + '\nDeposit: ' + (de?.value !== false ? '✅' : '❌') + '\nWithdraw: ' + (we?.value !== false ? '✅' : '❌');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Min WD', callback_data: 'set_minwd' }, { text: '📝 Max WD', callback_data: 'set_maxwd' }], [{ text: '📝 Daily WD', callback_data: 'set_dailywd' }], [{ text: (de?.value !== false ? '❌ Disable Dep' : '✅ Enable Dep'), callback_data: 'toggle_deposit' }], [{ text: (we?.value !== false ? '❌ Disable WD' : '✅ Enable WD'), callback_data: 'toggle_withdraw' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(m, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'set_minwd') { botSessions[chatId] = { step: 'setting_minwd' }; await bot.sendMessage(chatId, 'Send min withdrawal:\n/cancel'); }
            else if (action === 'set_maxwd') { botSessions[chatId] = { step: 'setting_maxwd' }; await bot.sendMessage(chatId, 'Send max withdrawal:\n/cancel'); }
            else if (action === 'set_dailywd') { botSessions[chatId] = { step: 'setting_dailywd' }; await bot.sendMessage(chatId, 'Send daily limit:\n/cancel'); }
            else if (action === 'toggle_deposit') { var cur = await Setting.findOne({ key: 'depositEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'depositEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(chatId, '✅ Deposits ' + (nv ? 'Enabled' : 'Disabled'), getMainMenuKeyboard()); }
            else if (action === 'toggle_withdraw') { var cur = await Setting.findOne({ key: 'withdrawEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'withdrawEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(chatId, '✅ Withdrawals ' + (nv ? 'Enabled' : 'Disabled'), getMainMenuKeyboard()); }

            else if (action === 'admin_referral') {
                var r = await Setting.findOne({ key: 'referralBonus' });
                var m = '🔗 *REFERRAL*\n\nBonus: ' + (r?.value || 11) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Change Bonus', callback_data: 'set_refbonus' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(m, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'set_refbonus') { botSessions[chatId] = { step: 'setting_refbonus' }; await bot.sendMessage(chatId, 'Send bonus % (0-100):\n/cancel'); }

            else if (action === 'admin_faq') {
                var faqs = await FAQ.find().sort({ order: 1 }).lean();
                var m = '❓ *FAQs (' + faqs.length + ')*\n\n';
                if (!faqs.length) m += 'None\n\n';
                else faqs.forEach(function (f, i) { m += (i + 1) + '. ' + f.question + '\n\n'; });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add FAQ', callback_data: 'faq_add' }], [{ text: '🗑️ Delete All', callback_data: 'faq_clear' }], [{ text: '🔙 Menu', callback_data: 'admin_dashboard' }]] } };
                await bot.editMessageText(m, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'faq_add') { botSessions[chatId] = { step: 'adding_faq' }; await bot.sendMessage(chatId, '❓ Send: Question | Answer\n\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'faq_clear') { await FAQ.deleteMany({}); await bot.sendMessage(chatId, '✅ All FAQs deleted!', getMainMenuKeyboard()); }

            else if (action === 'admin_broadcast') { botSessions[chatId] = { step: 'broadcasting' }; await bot.sendMessage(chatId, '📢 Send message:\n\n/cancel'); }
            else if (action === 'admin_search') { botSessions[chatId] = { step: 'searching_user' }; await bot.sendMessage(chatId, '🔍 Send username or PID:\n\n/cancel'); }

            // ========================================================
            // APPROVE/REJECT DEPOSIT - Remove buttons after action
            // ========================================================
            else if (action.startsWith('approve_deposit_')) {
                var tid = action.replace('approve_deposit_', '');
                await processDeposit(tid, 'approved', chatId, query.message.message_id);
            }
            else if (action.startsWith('reject_deposit_')) {
                var tid = action.replace('reject_deposit_', '');
                await processDeposit(tid, 'rejected', chatId, query.message.message_id);
            }

            // ========================================================
            // APPROVE/REJECT WITHDRAWAL - Remove buttons after action
            // ========================================================
            else if (action.startsWith('approve_withdrawal_')) {
                var tid = action.replace('approve_withdrawal_', '');
                await processWithdrawal(tid, 'approved', chatId, query.message.message_id);
            }
            else if (action.startsWith('reject_withdrawal_')) {
                var tid = action.replace('reject_withdrawal_', '');
                await processWithdrawal(tid, 'rejected', chatId, query.message.message_id);
            }

            else if (action.startsWith('user_toggle_')) {
                var un = action.replace('user_toggle_', '');
                var u = await User.findOne({ username: un });
                if (u) { u.status = u.status === 'active' ? 'blocked' : 'active'; await u.save(); bot.sendMessage(chatId, '✅ ' + u.username + ' → ' + u.status.toUpperCase()); }
            }

        } catch (e) {
            console.error('Bot error:', e.message);
            bot.sendMessage(chatId, '❌ Error: ' + e.message);
        }
    });

    // ============================================================
    // HANDLE TEXT MESSAGES FOR MULTI-STEP OPERATIONS
    // ============================================================
    bot.on('message', async function (msg) {
        var chatId = msg.chat.id.toString();
        if (chatId !== adminId || !msg.text) return;
        var text = msg.text.trim();
        var session = botSessions[chatId];

        if (text === '/cancel') { delete botSessions[chatId]; return bot.sendMessage(chatId, '❌ Cancelled', getMainMenuKeyboard()); }

        if (session) {
            if (session.step === 'adding_plan') {
                var parts = text.split('|').map(function (x) { return x.trim(); });
                if (parts.length < 4) return bot.sendMessage(chatId, '❌ Format: Name | Amount | Profit% | Days');
                var lp = await Plan.findOne().sort({ planId: -1 });
                await new Plan({ planId: (lp?.planId || 0) + 1, name: parts[0], amount: parseInt(parts[1]), dailyProfit: parseFloat(parts[2]), duration: parseInt(parts[3]) }).save();
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ Plan added!', getMainMenuKeyboard());
            }
            if (session.step === 'setting_transfer_fee') {
                var v = parseFloat(text);
                if (isNaN(v) || v < 0 || v > 100) return bot.sendMessage(chatId, '❌ Invalid (0-100)');
                await Setting.findOneAndUpdate({ key: 'fundTransferFee' }, { value: v }, { upsert: true });
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ TF Fee: ' + v + '%', getMainMenuKeyboard());
            }
            if (session.step === 'setting_easypaisa') {
                var p = text.split('|').map(function (x) { return x.trim(); });
                if (p.length < 2) return bot.sendMessage(chatId, '❌ Number | Title');
                await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: p[0] }, { upsert: true });
                await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: p[1] }, { upsert: true });
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ Easypaisa updated!', getMainMenuKeyboard());
            }
            if (session.step === 'setting_jazzcash') {
                var p = text.split('|').map(function (x) { return x.trim(); });
                if (p.length < 2) return bot.sendMessage(chatId, '❌ Number | Title');
                await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: p[0] }, { upsert: true });
                await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: p[1] }, { upsert: true });
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ JazzCash updated!', getMainMenuKeyboard());
            }
            if (session.step === 'setting_minwd') { await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[chatId]; return bot.sendMessage(chatId, '✅ Min WD: PKR ' + text, getMainMenuKeyboard()); }
            if (session.step === 'setting_maxwd') { await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[chatId]; return bot.sendMessage(chatId, '✅ Max WD: PKR ' + text, getMainMenuKeyboard()); }
            if (session.step === 'setting_dailywd') { await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[chatId]; return bot.sendMessage(chatId, '✅ Daily: PKR ' + text, getMainMenuKeyboard()); }
            if (session.step === 'setting_refbonus') { await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: parseFloat(text) }, { upsert: true }); delete botSessions[chatId]; return bot.sendMessage(chatId, '✅ Ref Bonus: ' + text + '%', getMainMenuKeyboard()); }
            if (session.step === 'adding_faq') {
                var p = text.split('|').map(function (x) { return x.trim(); });
                if (p.length < 2) return bot.sendMessage(chatId, '❌ Question | Answer');
                await new FAQ({ question: p[0], answer: p[1], order: await FAQ.countDocuments() + 1 }).save();
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ FAQ added!', getMainMenuKeyboard());
            }
            if (session.step === 'broadcasting') {
                var users = await User.find({ status: 'active' }).lean();
                var cnt = 0;
                for (var i = 0; i < users.length; i++) { try { await bot.sendMessage(users[i]._id, '📢 *Admin Message*\n\n' + text, { parse_mode: 'Markdown' }); cnt++; } catch (e) { } }
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '✅ Sent to ' + cnt + '/' + users.length, getMainMenuKeyboard());
            }
            if (session.step === 'searching_user') {
                var u = await User.findOne({ $or: [{ username: text }, { pid: text }] }).lean();
                if (!u) { delete botSessions[chatId]; return bot.sendMessage(chatId, '❌ Not found!', getMainMenuKeyboard()); }
                delete botSessions[chatId];
                var pi = u.activePlan?.planId ? u.activePlan.name + ' (Day ' + u.activePlan.profitDays + '/60)' : 'None';
                var um = '👤 *' + u.username + '*\n🆔 PID: ' + u.pid + '\n📱 ' + u.whatsapp + '\n📊 ' + (u.status === 'active' ? '🟢 Active' : '🔴 Blocked') + '\n💰 PKR ' + (u.balance || 0).toFixed(2) + '\n📋 ' + pi + '\n💵 Inv: PKR ' + (u.totalInvested || 0).toLocaleString() + '\n💎 Earn: PKR ' + (u.totalEarned || 0).toLocaleString() + '\n💸 WD: PKR ' + (u.totalWithdrawn || 0).toLocaleString() + '\n🎁 Ref: PKR ' + (u.referralEarnings || 0).toLocaleString() + '\n🔗 ' + (await User.countDocuments({ referredBy: u.referralCode })) + ' refs';
                var kb = { reply_markup: { inline_keyboard: [[{ text: u.status === 'active' ? '🔴 Block' : '🟢 Unblock', callback_data: 'user_toggle_' + u.username }]] } };
                return bot.sendMessage(chatId, um, { parse_mode: 'Markdown', ...kb });
            }
        }
    });
}

// ================================================================
// SHOW PENDING TRANSACTIONS WITH BUTTONS
// ================================================================
async function showPendingTransactions(type, chatId, messageId) {
    var items = await Transaction.find({ type: type, status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean();
    if (!items || items.length === 0) {
        return bot.editMessageText('✅ No pending ' + type + 's', { chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_dashboard' }]] }
        });
    }

    await bot.deleteMessage(chatId, messageId);

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var user = await User.findOne({ username: it.username }).lean();
        var message = '';
        var approveCallback = '';
        var rejectCallback = '';

        if (type === 'deposit') {
            message = '💰 *NEW DEPOSIT REQUEST*\n\n' +
                '👤 User: ' + it.username + '\n' +
                '🆔 PID: ' + (user?.pid || 'N/A') + '\n' +
                '💵 Amount: PKR ' + it.amount.toLocaleString() + '\n' +
                '📋 Plan: ' + (it.planName || 'Plan ' + it.planId) + '\n' +
                '🏦 Method: ' + it.accountType.toUpperCase() + '\n' +
                '🔢 TxID: `' + it.txId + '`\n' +
                '📅 Date: ' + new Date(it.createdAt).toLocaleString();
            approveCallback = 'approve_deposit_' + it._id;
            rejectCallback = 'reject_deposit_' + it._id;
        } else {
            message = '💸 *NEW WITHDRAWAL REQUEST*\n\n' +
                '👤 User: ' + it.username + '\n' +
                '🆔 PID: ' + (user?.pid || 'N/A') + '\n' +
                '💰 Balance: PKR ' + (user?.balance || 0).toFixed(2) + '\n' +
                '💵 Amount: PKR ' + it.amount.toLocaleString() + '\n' +
                '🏦 Method: ' + it.accountType.toUpperCase() + '\n' +
                '🔢 Account: `' + it.accountNumber + '`\n' +
                '📛 Title: ' + it.accountTitle + '\n' +
                '📅 Date: ' + new Date(it.createdAt).toLocaleString();
            approveCallback = 'approve_withdrawal_' + it._id;
            rejectCallback = 'reject_withdrawal_' + it._id;
        }

        var actionKeyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ APPROVE', callback_data: approveCallback },
                    { text: '❌ REJECT', callback_data: rejectCallback }
                ]]
            }
        };

        var sentMsg;
        if (type === 'deposit' && it.screenshot && fs.existsSync(it.screenshot)) {
            try {
                sentMsg = await bot.sendPhoto(chatId, it.screenshot, { caption: message, parse_mode: 'Markdown', ...actionKeyboard });
            } catch (e) {
                sentMsg = await bot.sendMessage(chatId, message + '\n\n⚠️ Screenshot not available', { parse_mode: 'Markdown', ...actionKeyboard });
            }
        } else {
            sentMsg = await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...actionKeyboard });
        }

        // Save message ID for future updates
        if (sentMsg) {
            await Transaction.findByIdAndUpdate(it._id, { telegramMsgId: sentMsg.message_id });
        }
    }
}

// ================================================================
// PROCESS DEPOSIT - Remove buttons after action
// ================================================================
async function processDeposit(transactionId, status, chatId, messageId) {
    var transaction = await Transaction.findById(transactionId);
    if (!transaction) return bot.sendMessage(chatId, '❌ Transaction not found');
    if (transaction.status !== 'pending') return bot.sendMessage(chatId, '⚠️ Already ' + transaction.status);

    transaction.status = status;
    transaction.processedAt = new Date();
    await transaction.save();

    // Remove buttons from original message
    if (transaction.telegramMsgId) {
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: transaction.telegramMsgId
            });
        } catch (e) {
            console.error('Could not remove buttons:', e.message);
        }
    }

    // Edit message to show status
    var statusText = status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
    if (transaction.telegramMsgId) {
        try {
            var originalCaption = status === 'approved' ? 
                '✅ *DEPOSIT APPROVED!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString() :
                '❌ *DEPOSIT REJECTED!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString();
            
            if (transaction.screenshot && fs.existsSync(transaction.screenshot)) {
                await bot.editMessageCaption(originalCaption, {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId,
                    parse_mode: 'Markdown'
                });
            } else {
                await bot.editMessageText(originalCaption, {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId,
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            console.error('Could not edit message:', e.message);
        }
    }

    if (status === 'approved') {
        var user = await User.findOne({ username: transaction.username });
        var plan = await Plan.findOne({ planId: transaction.planId });
        if (user && plan) {
            var dailyProfitAmount = plan.amount * (plan.dailyProfit / 100);
            user.activePlan = { planId: plan.planId, name: plan.name, amount: plan.amount, dailyProfit: dailyProfitAmount, startDate: new Date(), endDate: new Date(Date.now() + plan.duration * 86400000), profitDays: 0 };
            user.totalInvested += plan.amount;
            var firstProfit = dailyProfitAmount;
            user.balance += firstProfit; user.totalEarned += firstProfit; user.activePlan.profitDays += 1;
            await user.save();
            await new Transaction({ userId: user._id, username: user.username, type: 'profit', amount: firstProfit, status: 'approved' }).save();

            if (user.referredBy) {
                var referrer = await User.findOne({ referralCode: user.referredBy });
                if (referrer) {
                    var bonusSetting = await Setting.findOne({ key: 'referralBonus' });
                    var bonus = plan.amount * ((bonusSetting?.value || 11) / 100);
                    referrer.balance += bonus; referrer.referralEarnings += bonus;
                    await referrer.save();
                    await new Transaction({ userId: referrer._id, username: referrer.username, type: 'referral', amount: bonus, status: 'approved' }).save();
                    bot.sendMessage(chatId, '🎁 Bonus PKR ' + bonus + ' → ' + referrer.username);
                }
            }
        }
    }

    bot.sendMessage(chatId, '✅ *DEPOSIT ' + status.toUpperCase() + '!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString(), { parse_mode: 'Markdown' });
}

// ================================================================
// PROCESS WITHDRAWAL - Remove buttons after action
// ================================================================
async function processWithdrawal(transactionId, status, chatId, messageId) {
    var transaction = await Transaction.findById(transactionId);
    if (!transaction) return bot.sendMessage(chatId, '❌ Transaction not found');
    if (transaction.status !== 'pending') return bot.sendMessage(chatId, '⚠️ Already ' + transaction.status);

    transaction.status = status;
    transaction.processedAt = new Date();
    await transaction.save();

    // Remove buttons from original message
    if (transaction.telegramMsgId) {
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: transaction.telegramMsgId
            });
        } catch (e) {
            console.error('Could not remove buttons:', e.message);
        }
    }

    // Edit message to show status
    if (transaction.telegramMsgId) {
        try {
            var statusMsg = status === 'approved' ?
                '✅ *WITHDRAWAL APPROVED!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString() :
                '❌ *WITHDRAWAL REJECTED!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString() + '\nℹ️ Amount will be refunded after 1 hour';
            
            await bot.editMessageText(statusMsg, {
                chat_id: chatId,
                message_id: transaction.telegramMsgId,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            console.error('Could not edit message:', e.message);
        }
    }

    if (status === 'approved') {
        var user = await User.findOne({ username: transaction.username });
        if (user) { user.totalWithdrawn += transaction.amount; user.pendingWithdrawal = false; await user.save(); }
    }

    if (status === 'rejected') {
        var user = await User.findOne({ username: transaction.username });
        if (user) {
            transaction.refundAt = new Date(Date.now() + 3600000);
            await transaction.save();
            bot.sendMessage(chatId, 'ℹ️ Refund after 1 hour for ' + user.username);
            setTimeout(async function () {
                try {
                    user.balance += transaction.amount;
                    user.pendingWithdrawal = false;
                    await user.save();
                    transaction.status = 'refunded';
                    await transaction.save();
                    await new Transaction({ userId: user._id, username: user.username, type: 'refund', amount: transaction.amount, status: 'completed' }).save();
                    bot.sendMessage(chatId, '✅ *REFUND COMPLETED!*\n👤 ' + user.username + '\n💵 PKR ' + transaction.amount.toLocaleString(), { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error('Refund error:', error.message);
                }
            }, 3600000);
        }
    }

    bot.sendMessage(chatId, '✅ *WITHDRAWAL ' + status.toUpperCase() + '!*\n👤 ' + transaction.username + '\n💵 PKR ' + transaction.amount.toLocaleString(), { parse_mode: 'Markdown' });
}

// ================================================================
// NOTIFICATION HELPERS
// ================================================================
async function notifyAdminDeposit(username, pid, amount, planName, accountType, txId, screenshotPath) {
    if (!bot || !process.env.TELEGRAM_ADMIN_ID) return;

    var message = '💰 <b>NEW DEPOSIT REQUEST</b>\n\n' +
        '👤 User: ' + username + '\n' +
        '🆔 PID: ' + pid + '\n' +
        '💵 Amount: PKR ' + amount.toLocaleString() + '\n' +
        '📋 Plan: ' + planName + '\n' +
        '🏦 Method: ' + accountType.toUpperCase() + '\n' +
        '🔢 TxID: ' + txId + '\n' +
        '📅 ' + new Date().toLocaleString();

    try {
        if (screenshotPath && fs.existsSync(screenshotPath)) {
            await bot.sendPhoto(process.env.TELEGRAM_ADMIN_ID, screenshotPath, {
                caption: message,
                parse_mode: 'HTML'
            });
        } else {
            await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, message, { parse_mode: 'HTML' });
        }
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function notifyAdminWithdrawal(username, pid, amount, accountType, accountNumber, accountTitle) {
    if (!bot || !process.env.TELEGRAM_ADMIN_ID) return;

    var message = '💸 <b>NEW WITHDRAWAL REQUEST</b>\n\n' +
        '👤 User: ' + username + '\n' +
        '🆔 PID: ' + pid + '\n' +
        '💵 Amount: PKR ' + amount.toLocaleString() + '\n' +
        '🏦 Method: ' + accountType.toUpperCase() + '\n' +
        '🔢 Account: ' + accountNumber + '\n' +
        '📛 Title: ' + accountTitle + '\n' +
        '📅 ' + new Date().toLocaleString();

    try {
        await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, message, { parse_mode: 'HTML' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

async function notifyAdminTransfer(senderUsername, senderPid, receiverUsername, receiverPid, amount, fee) {
    if (!bot || !process.env.TELEGRAM_ADMIN_ID) return;

    var message = '🔄 <b>FUND TRANSFER</b>\n\n' +
        '📤 Sender: ' + senderUsername + ' (PID:' + senderPid + ')\n' +
        '📥 Receiver: ' + receiverUsername + ' (PID:' + receiverPid + ')\n' +
        '💵 Amount: PKR ' + amount.toLocaleString() + '\n' +
        '💰 Fee: PKR ' + fee.toFixed(2) + '\n' +
        '📅 ' + new Date().toLocaleString();

    try {
        await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, message, { parse_mode: 'HTML' });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
}

// ================================================================
// AUTH MIDDLEWARE
// ================================================================
function authenticateRequest(req, res, next) {
    var authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Login required' });
    try { req.userId = jwt.verify(authHeader, process.env.JWT_SECRET).userId; next(); } catch (e) { res.status(401).json({ success: false, error: 'Invalid token' }); }
}

// ================================================================
// API ROUTES
// ================================================================

app.get('/api/health', function (req, res) { res.json({ success: true, time: new Date().toISOString() }); });

// Signup
app.post('/api/signup', async function (req, res) {
    try {
        var username = req.body.username, whatsapp = req.body.whatsapp, password = req.body.password, referralCode = req.body.referralCode;
        if (!username || !whatsapp || !password) return res.status(400).json({ success: false, error: 'All fields required' });
        if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be 6+ characters' });
        if (await User.findOne({ username: username })) return res.status(400).json({ success: false, error: 'Username already taken' });
        var pid = generatePID(whatsapp);
        var exists = await User.findOne({ pid: pid });
        if (exists) pid = pid + Math.floor(Math.random() * 9);
        var hashed = await bcrypt.hash(password, 10);
        var user = new User({ username: username, whatsapp: whatsapp, password: hashed, pid: pid, referralCode: pid, referredBy: referralCode || null });
        await user.save();
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ success: true, token: token, username: user.username, pid: user.pid });
    } catch (e) { res.status(500).json({ success: false, error: 'Registration failed' }); }
});

// Login
app.post('/api/login', async function (req, res) {
    try {
        var username = req.body.username, password = req.body.password;
        var user = await User.findOne({ username: username });
        if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        if (user.status === 'blocked') return res.status(403).json({ success: false, error: 'Account blocked' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token: token, username: user.username, pid: user.pid, balance: user.balance });
    } catch (e) { res.status(500).json({ success: false, error: 'Login failed' }); }
});

// Dashboard
app.get('/api/dashboard', authenticateRequest, async function (req, res) {
    var user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var tp = await Transaction.aggregate([{ $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
    var pendDep = await Transaction.countDocuments({ userId: user._id, type: 'deposit', status: 'pending' });
    var pendWd = await Transaction.countDocuments({ userId: user._id, type: 'withdraw', status: 'pending' });
    res.json({ success: true, username: user.username, pid: user.pid, profilePic: user.profilePic, balance: user.balance || 0, activePlan: user.activePlan || null, totalInvested: user.totalInvested || 0, totalEarned: user.totalEarned || 0, referralEarnings: user.referralEarnings || 0, totalWithdrawn: user.totalWithdrawn || 0, referralCount: await User.countDocuments({ referredBy: user.referralCode }), referralCode: user.referralCode, todayProfit: tp[0]?.t || 0, pendingDeposits: pendDep, pendingWithdrawals: pendWd, pendingWithdrawal: user.pendingWithdrawal });
});

// Plans
app.get('/api/plans', authenticateRequest, async function (req, res) { res.json({ success: true, plans: await Plan.find({ isActive: true }).sort({ planId: 1 }).lean() }); });

// Deposit Accounts
app.get('/api/deposit-accounts', authenticateRequest, async function (req, res) {
    var epN = await Setting.findOne({ key: 'easypaisaNumber' }), epT = await Setting.findOne({ key: 'easypaisaTitle' });
    var jcN = await Setting.findOne({ key: 'jazzcashNumber' }), jcT = await Setting.findOne({ key: 'jazzcashTitle' });
    res.json({ success: true, easypaisa: { number: epN?.value || 'N/A', title: epT?.value || 'N/A' }, jazzcash: { number: jcN?.value || 'N/A', title: jcT?.value || 'N/A' } });
});

// Deposit
app.post('/api/deposit', authenticateRequest, uploadDeposit.single('screenshot'), async function (req, res) {
    try {
        var de = await Setting.findOne({ key: 'depositEnabled' });
        if (de?.value === false) return res.status(400).json({ success: false, error: 'Deposits are temporarily disabled' });
        var planId = req.body.planId, accountType = req.body.accountType, txId = req.body.txId;
        if (!planId || !accountType || !txId || !req.file) return res.status(400).json({ success: false, error: 'All fields + screenshot required' });
        var plan = await Plan.findOne({ planId: parseInt(planId) });
        if (!plan) return res.status(400).json({ success: false, error: 'Invalid plan' });
        var user = await User.findById(req.userId);
        if (user.activePlan?.planId) return res.status(400).json({ success: false, error: 'You already have an active plan' });
        var tx = new Transaction({ userId: req.userId, username: user.username, type: 'deposit', amount: plan.amount, accountType: accountType, screenshot: req.file.path, txId: txId, planId: plan.planId, planName: plan.name });
        await tx.save();
        await notifyAdminDeposit(user.username, user.pid, plan.amount, plan.name, accountType, txId, req.file.path);
        res.json({ success: true, message: 'Deposit submitted! Awaiting approval.' });
    } catch (e) { res.status(500).json({ success: false, error: 'Error' }); }
});

// Withdraw
app.post('/api/withdraw', authenticateRequest, async function (req, res) {
    try {
        var we = await Setting.findOne({ key: 'withdrawEnabled' });
        if (we?.value === false) return res.status(400).json({ success: false, error: 'Withdrawals are temporarily disabled' });
        var accountType = req.body.accountType, accountNumber = req.body.accountNumber, accountTitle = req.body.accountTitle, amount = parseFloat(req.body.amount);
        if (!accountType || !accountNumber || !accountTitle || !amount) return res.status(400).json({ success: false, error: 'All fields required' });
        var user = await User.findById(req.userId);
        if (!user.activePlan?.planId) return res.status(400).json({ success: false, error: 'No active plan' });
        if (user.pendingWithdrawal) return res.status(400).json({ success: false, error: 'Pending withdrawal exists' });
        if (user.balance < amount) return res.status(400).json({ success: false, error: 'Insufficient balance' });
        var minW = await Setting.findOne({ key: 'minWithdraw' });
        if (amount < (minW?.value || 30)) return res.status(400).json({ success: false, error: 'Min: PKR ' + (minW?.value || 30) });
        user.balance -= amount;
        user.pendingWithdrawal = true;
        await user.save();
        var tx = new Transaction({ userId: req.userId, username: user.username, type: 'withdraw', amount: amount, accountType: accountType, accountNumber: accountNumber, accountTitle: accountTitle });
        await tx.save();
        await notifyAdminWithdrawal(user.username, user.pid, amount, accountType, accountNumber, accountTitle);
        res.json({ success: true, message: 'Withdrawal submitted! Amount deducted.' });
    } catch (e) { res.status(500).json({ success: false, error: 'Error' }); }
});

// Fund Transfer
app.post('/api/fund-transfer', authenticateRequest, async function (req, res) {
    try {
        var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
        if (fte?.value === false) return res.status(400).json({ success: false, error: 'Fund Transfer disabled' });
        var receiverPid = req.body.receiverPid, amount = parseFloat(req.body.amount);
        if (!receiverPid || !amount) return res.status(400).json({ success: false, error: 'PID and Amount required' });
        var sender = await User.findById(req.userId);
        if (!sender.activePlan?.planId) return res.status(400).json({ success: false, error: 'No active plan' });
        var feeSetting = await Setting.findOne({ key: 'fundTransferFee' });
        var feePercent = feeSetting?.value || 0;
        var feeAmount = amount * (feePercent / 100);
        var total = amount + feeAmount;
        if (sender.balance < total) return res.status(400).json({ success: false, error: 'Insufficient balance (fee: PKR ' + feeAmount.toFixed(2) + ')' });
        var receiver = await User.findOne({ pid: receiverPid });
        if (!receiver) return res.status(400).json({ success: false, error: 'PID not found' });
        if (receiver._id.toString() === sender._id.toString()) return res.status(400).json({ success: false, error: 'Cannot transfer to yourself' });
        sender.balance -= total;
        receiver.balance += amount;
        await sender.save();
        await receiver.save();
        await new Transaction({ userId: sender._id, username: sender.username, type: 'transfer_sent', amount: amount, fee: feeAmount, status: 'completed', relatedUserId: receiver._id, relatedUsername: receiver.username }).save();
        await new Transaction({ userId: receiver._id, username: receiver.username, type: 'transfer_received', amount: amount, status: 'completed', relatedUserId: sender._id, relatedUsername: sender.username }).save();
        await notifyAdminTransfer(sender.username, sender.pid, receiver.username, receiver.pid, amount, feeAmount);
        res.json({ success: true, message: 'Transfer successful!', senderBalance: sender.balance, fee: feeAmount, receiverUsername: receiver.username });
    } catch (e) { res.status(500).json({ success: false, error: 'Transfer failed' }); }
});

// Verify PID
app.post('/api/verify-pid', authenticateRequest, async function (req, res) {
    var receiver = await User.findOne({ pid: req.body.pid }).select('username whatsapp pid profilePic').lean();
    if (!receiver) return res.status(404).json({ success: false, error: 'PID not found' });
    res.json({ success: true, user: receiver });
});

// Profile
app.get('/api/profile', authenticateRequest, async function (req, res) {
    var user = await User.findById(req.userId).select('username whatsapp pid profilePic createdAt').lean();
    res.json({ success: true, user: user });
});

app.put('/api/profile', authenticateRequest, uploadProfile.single('profilePic'), async function (req, res) {
    var user = await User.findById(req.userId);
    if (req.body.whatsapp) { user.whatsapp = req.body.whatsapp; user.pid = generatePID(req.body.whatsapp); user.referralCode = user.pid; }
    if (req.body.password) { if (req.body.password.length < 6) return res.status(400).json({ success: false, error: 'Password 6+ chars' }); user.password = await bcrypt.hash(req.body.password, 10); }
    if (req.file) user.profilePic = '/uploads/' + req.file.filename;
    await user.save();
    res.json({ success: true, message: 'Profile updated' });
});

// Transactions
app.get('/api/transactions', authenticateRequest, async function (req, res) { res.json({ success: true, transactions: await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean() }); });
app.get('/api/deposits', authenticateRequest, async function (req, res) { res.json({ success: true, deposits: await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(50).lean() }); });
app.get('/api/withdrawals', authenticateRequest, async function (req, res) { res.json({ success: true, withdrawals: await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(50).lean() }); });

// Team
app.get('/api/team', authenticateRequest, async function (req, res) {
    var user = await User.findById(req.userId);
    var team = await User.find({ referredBy: user.referralCode }).select('username pid totalInvested createdAt').sort({ createdAt: -1 }).lean();
    res.json({ success: true, teamCount: team.length, team: team });
});

// Leaderboard
app.get('/api/leaderboard', authenticateRequest, async function (req, res) {
    var ti = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username totalInvested').lean();
    var tr = await User.aggregate([{ $match: { status: 'active' } }, { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'r' } }, { $project: { username: 1, c: { $size: '$r' } } }, { $sort: { c: -1 } }, { $limit: 10 }]);
    res.json({ success: true, topInvestors: ti, topReferrers: tr });
});

// FAQs
app.get('/api/faqs', async function (req, res) { res.json({ success: true, faqs: await FAQ.find().sort({ order: 1 }).lean() }); });

// Settings
app.get('/api/settings', async function (req, res) {
    var settings = await Setting.find({}).lean();
    var result = {};
    settings.forEach(function (s) { result[s.key] = s.value; });
    res.json({ success: true, settings: result });
});

// ================================================================
// URDU + ENGLISH AI CHATBOT
// ================================================================
app.post('/api/chat', async function (req, res) {
    try {
        var message = (req.body.message || '').trim();
        var msgLower = message.toLowerCase();
        var isUrdu = /[\u0600-\u06FF]/.test(message);
        var reply = '';

        // URDU RESPONSES
        if (isUrdu) {
            if (msgLower.includes('invest') || msgLower.includes('سرمایہ') || msgLower.includes('انویسٹ') || msgLower.includes('پلان') || msgLower.includes('deposit')) {
                reply = 'سرمایہ کاری کرنے کے لیے:\n\n1. ڈپازٹ پیج پر جائیں\n2. کوئی بھی پلان منتخب کریں (PKR 360 سے PKR 50,000 تک)\n3. Easypaisa یا JazzCash منتخب کریں\n4. دیے گئے اکاؤنٹ میں رقم بھیجیں\n5. اسکرین شاٹ اور ٹرانزیکشن ID اپ لوڈ کریں\n6. ایڈمن کی منظوری کا انتظار کریں\n\nمنظوری کے فوراً بعد پہلا منافع مل جائے گا!';
            } else if (msgLower.includes('profit') || msgLower.includes('منافع') || msgLower.includes('earning') || msgLower.includes('کمائی')) {
                reply = 'آپ 60 دنوں تک روزانہ 11% منافع کماتے ہیں۔\n\nمثال:\n- PKR 360 = PKR 39.60 روزانہ × 60 دن = PKR 2,376 کل\n- PKR 5,000 = PKR 550 روزانہ × 60 دن = PKR 33,000 کل\n- PKR 50,000 = PKR 5,500 روزانہ × 60 دن = PKR 330,000 کل';
            } else if (msgLower.includes('withdraw') || msgLower.includes('نکاسی') || msgLower.includes('وڈرا') || msgLower.includes('پیسے')) {
                reply = 'رقم نکالنے کے لیے:\n\n1. وڈرا پیج پر جائیں\n2. Easypaisa یا JazzCash منتخب کریں\n3. اپنا اکاؤنٹ نمبر اور ٹائٹل درج کریں\n4. رقم درج کریں (کم از کم PKR 30)\n5. رقم فوری طور پر بیلنس سے کٹ جائے گی\n6. ایڈمن آپ کی درخواست پر کارروائی کرے گا';
            } else if (msgLower.includes('refer') || msgLower.includes('ریف') || msgLower.includes('ریف') || msgLower.includes('دوست')) {
                reply = 'ریف سسٹم:\n\n- اپنا PID کوڈ بطور ریفرل لنک شیئر کریں\n- جب کوئی آپ کے لنک سے جوائن کرے اور سرمایہ کاری کرے\n- آپ کو فوری طور پر ان کی سرمایہ کاری کا 11% بونس ملے گا!\n\nمثال: اگر وہ PKR 10,000 لگاتے ہیں تو آپ کو PKR 1,100 ملیں گے';
            } else if (msgLower.includes('transfer') || msgLower.includes('منتق') || msgLower.includes('بھیج')) {
                reply = 'فنڈ ٹرانسفر:\n\n1. فنڈ ٹرانسفر پیج پر جائیں\n2. وصول کنندہ کا PID درج کریں\n3. رقم درج کریں\n4. تصدیق کے بعد ٹرانسفر کریں\n\nٹرانسفر فوری ہے، کسی منظوری کی ضرورت نہیں!';
            } else if (msgLower.includes('balance') || msgLower.includes('بیلنس') || msgLower.includes('رقم')) {
                reply = 'آپ کا بیلنس ڈیش بورڈ پر نظر آتا ہے۔ آپ دیکھ سکتے ہیں:\n\n- کل بیلنس\n- آج کا منافع\n- کل سرمایہ کاری\n- کل کمائی\n- ریفرل بونس\n- زیر التوا ڈپازٹ/وڈرا\n- کل نکاسی';
            } else if (msgLower.includes('salam') || msgLower.includes('سلام') || msgLower.includes('hello') || msgLower.includes('hi') || msgLower.includes('ہیلو')) {
                reply = 'السلام علیکم! 👋 پروفٹ 24 میں خوش آمدید۔\n\nمیں آپ کی کیا مدد کر سکتا ہوں؟\n\nآپ پوچھ سکتے ہیں:\n- سرمایہ کاری کے پلان\n- ڈپازٹ کا طریقہ\n- رقم نکالنے کا طریقہ\n- منافع کا حساب\n- ریفرل سسٹم\n- فنڈ ٹرانسفر';
            } else if (msgLower.includes('shukriya') || msgLower.includes('شکریہ') || msgLower.includes('thanks')) {
                reply = 'آپ کا شکریہ! 😊\n\nاگر کوئی اور مدد چاہیے تو ضرور پوچھیں۔ ہم 24/7 آپ کی خدمت کے لیے حاضر ہیں۔';
            } else {
                reply = 'معذرت، میں صرف پروفٹ 24 پلیٹ فارم سے متعلق سوالات کے جواب دے سکتا ہوں۔\n\nبراہ کرم پوچھیں:\n- سرمایہ کاری کیسے کریں؟\n- منافع کب ملتا ہے؟\n- رقم کیسے نکالیں؟\n- ریفرل بونس کیا ہے؟\n- فنڈ ٹرانسفر کیسے کریں؟';
            }
        }
        // ENGLISH RESPONSES
        else {
            if (msgLower.includes('invest') || msgLower.includes('deposit') || msgLower.includes('plan') || msgLower.includes('package')) {
                reply = 'To invest in Profit 24:\n\n1. Go to the Deposit page\n2. Select an investment plan (PKR 360 to PKR 50,000+)\n3. Choose Easypaisa or JazzCash as payment method\n4. Send the exact plan amount to the provided account\n5. Upload payment screenshot with Transaction ID\n6. Submit for admin approval\n\nYou will receive your first profit immediately after approval!';
            } else if (msgLower.includes('profit') || msgLower.includes('earning') || msgLower.includes('return') || msgLower.includes('daily')) {
                reply = 'You earn 11% daily profit on your investment for 60 days.\n\nExample:\n- PKR 360 investment = PKR 39.60 daily × 60 days = PKR 2,376 total\n- PKR 5,000 investment = PKR 550 daily × 60 days = PKR 33,000 total\n- PKR 50,000 investment = PKR 5,500 daily × 60 days = PKR 330,000 total\n\nFirst profit is credited immediately after deposit approval.';
            } else if (msgLower.includes('withdraw') || msgLower.includes('cash')) {
                reply = 'To withdraw funds:\n\n1. Go to the Withdraw page\n2. Select Easypaisa or JazzCash\n3. Enter your account number and account title\n4. Enter the amount (Min: PKR 30)\n5. Amount will be deducted from balance immediately\n6. Admin will process your request\n\nNote: You can only have one pending withdrawal at a time.';
            } else if (msgLower.includes('refer') || msgLower.includes('bonus')) {
                reply = 'Referral System:\n\n- Share your PID code as referral link\n- When someone joins using your referral and makes a deposit\n- You earn 11% of their investment amount as bonus instantly!\n\nExample: If they invest PKR 10,000, you receive PKR 1,100 bonus.';
            } else if (msgLower.includes('transfer') || msgLower.includes('send fund')) {
                reply = 'Fund Transfer:\n\n1. Go to Fund Transfer page\n2. Enter the receiver\'s PID\n3. Enter the amount you want to transfer\n4. Click Next to verify the receiver\n5. Confirm the transfer\n\nTransfer is instant with no admin approval needed. You need an active plan to transfer funds.';
            } else if (msgLower.includes('balance') || msgLower.includes('check')) {
                reply = 'Your balance is displayed on the Dashboard. You can view:\n\n- Total Balance\n- Today\'s Profit\n- Total Invested\n- Total Earned\n- Referral Bonus\n- Pending Deposits\n- Pending Withdrawals\n- Total Withdrawn';
            } else if (msgLower.includes('hi') || msgLower.includes('hello') || msgLower.includes('hey')) {
                reply = 'Hello! 👋 Welcome to Profit 24 Support.\n\nI can help you with:\n- Investment Plans\n- Deposit Process\n- Withdrawals\n- Profit Calculations\n- Referral System\n- Fund Transfer\n- Account Management\n\nWhat would you like to know?';
            } else if (msgLower.includes('thank')) {
                reply = 'You\'re welcome! 😊\n\nIf you need any further assistance, feel free to ask. We\'re here to help you 24/7.\n\nHappy investing with Profit 24! 💎';
            } else {
                reply = 'I can answer questions about the Profit 24 platform only.\n\nTry asking about:\n• Investment Plans\n• How to Deposit\n• How to Withdraw\n• Profit Calculation\n• Referral System\n• Fund Transfer\n• Account Management\n\nHow can I help you today?';
            }
        }

        res.json({ success: true, reply: reply });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Chat failed' });
    }
});

// ================================================================
// DAILY PROFIT CRON JOB
// ================================================================
cron.schedule('0 0 * * *', async function () {
    var users = await User.find({ 'activePlan.planId': { $exists: true }, 'activePlan.endDate': { $gte: new Date() }, 'activePlan.profitDays': { $lt: 60 }, status: 'active' });
    for (var i = 0; i < users.length; i++) { var u = users[i]; u.balance += u.activePlan.dailyProfit; u.totalEarned += u.activePlan.dailyProfit; u.activePlan.profitDays += 1; await u.save(); await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: u.activePlan.dailyProfit, status: 'approved' }).save(); }
});

// ================================================================
// DATABASE INIT
// ================================================================
async function init() {
    if (await Plan.countDocuments() === 0) await Plan.insertMany([{ planId: 1, name: 'Starter', amount: 360 }, { planId: 2, name: 'Silver', amount: 860 }, { planId: 3, name: 'Gold', amount: 1460 }, { planId: 4, name: 'Platinum', amount: 2660 }, { planId: 5, name: 'Diamond', amount: 4260 }, { planId: 6, name: 'Ruby', amount: 6060 }, { planId: 7, name: 'Emerald', amount: 9060 }, { planId: 8, name: 'Sapphire', amount: 14060 }, { planId: 9, name: 'Titanium', amount: 21060 }, { planId: 10, name: 'Master', amount: 30000 }, { planId: 11, name: 'Custom', amount: 50000 }]);
    if (await Setting.countDocuments() === 0) await Setting.insertMany([{ key: 'referralBonus', value: 11 }, { key: 'minWithdraw', value: 30 }, { key: 'maxWithdraw', value: 500000 }, { key: 'maxDailyWithdraw', value: 100000 }, { key: 'easypaisaNumber', value: '03000000000' }, { key: 'easypaisaTitle', value: 'Profit 24' }, { key: 'jazzcashNumber', value: '03000000000' }, { key: 'jazzcashTitle', value: 'Profit 24' }, { key: 'depositEnabled', value: true }, { key: 'withdrawEnabled', value: true }, { key: 'fundTransferEnabled', value: true }, { key: 'fundTransferFee', value: 0 }]);
    if (await FAQ.countDocuments() === 0) await FAQ.insertMany([{ question: 'What is Profit 24?', answer: 'Profit 24 is a secure investment platform where you can invest and earn 11% daily profit for 60 days.', order: 1 }, { question: 'How to invest?', answer: 'Select a plan, send payment via Easypaisa/JazzCash, upload screenshot with TxID, and wait for approval.', order: 2 }, { question: 'How does referral work?', answer: 'Share your PID. Earn 11% bonus when someone invests using your referral.', order: 3 }, { question: 'Minimum withdrawal?', answer: 'PKR 30 minimum. PKR 500,000 maximum per request.', order: 4 }]);
}

// ================================================================
// START SERVER
// ================================================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/profit24')
    .then(async function () { console.log('MongoDB OK'); await init(); initTelegramBot(); app.listen(PORT, function () { console.log('Server:' + PORT); }); })
    .catch(function (e) { console.error(e); process.exit(1); });
