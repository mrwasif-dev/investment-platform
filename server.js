// ============================================================
// PROFIT 24 - COMPLETE BACKEND SERVER
// All features: Auth, Plans, Deposit, Withdraw, Fund Transfer,
// Profile, PID System, Referral, Telegram Bot Admin, AI Chatbot
// ============================================================

require('dotenv').config();

// ============ IMPORTS ============
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

// ============ APP SETUP ============
const app = express();
const PORT = process.env.PORT || 5000;

// Create directories
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============ MULTER CONFIG ============
const depStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        cb(null, 'dep-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const upload = multer({ storage: depStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const dpStorage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/'); },
    filename: function (req, file, cb) {
        cb(null, 'dp-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const uploadDP = multer({ storage: dpStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ============ MONGODB MODELS ============

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
    value: { type: mongoose.Schema.Types.Mixed, required: true }
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

// ============ PID GENERATOR ============
function generatePID(whatsapp) {
    var cleaned = whatsapp.replace(/[\s\-\+\(\)]/g, '');
    if (cleaned.length >= 5) return cleaned.slice(-5);
    return cleaned.padStart(5, '0');
}

// ============ TELEGRAM BOT ============
var bot = null;
var sessions = {};

function initBot() {
    var token = process.env.TELEGRAM_BOT_TOKEN;
    var adminId = process.env.TELEGRAM_ADMIN_ID;
    if (!token || !adminId) { console.log('Bot not configured'); return; }

    bot = new TelegramBot(token, { polling: true });
    console.log('✅ Telegram Bot Connected');

    function mainMenu() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard', callback_data: 'dash' }],
                    [{ text: '👥 Users List', callback_data: 'users' }],
                    [{ text: '💰 Pending Deposits', callback_data: 'deps' }],
                    [{ text: '💸 Pending Withdrawals', callback_data: 'wds' }],
                    [{ text: '📋 Manage Plans', callback_data: 'plans' }],
                    [{ text: '🔄 Fund Transfer Settings', callback_data: 'ftset' }],
                    [{ text: '🏦 Payment Accounts', callback_data: 'accs' }],
                    [{ text: '⚙️ System Settings', callback_data: 'sett' }],
                    [{ text: '🔗 Referral Settings', callback_data: 'ref' }],
                    [{ text: '❓ FAQ Management', callback_data: 'faq' }],
                    [{ text: '📢 Broadcast Message', callback_data: 'bcast' }],
                    [{ text: '🔍 Search User', callback_data: 'search' }]
                ]
            }
        };
    }

    bot.onText(/\/start|\/admin/, function(msg) {
        if (msg.chat.id.toString() !== adminId) return;
        bot.sendMessage(adminId, '🔐 *ADMIN PANEL*\n\nWelcome! All controls via buttons below:', { parse_mode: 'Markdown', ...mainMenu() });
    });

    bot.on('callback_query', async function(q) {
        var cid = q.message.chat.id.toString();
        if (cid !== adminId) return bot.answerCallbackQuery(q.id);
        var a = q.data;
        await bot.answerCallbackQuery(q.id);

        try {
            if (a === 'dash') {
                var tu = await User.countDocuments();
                var ap = await User.countDocuments({ 'activePlan.planId': { $exists: true }, status: 'active' });
                var pd = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
                var pw = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
                var td = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'approved' } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
                var tw = await Transaction.aggregate([{ $match: { type: 'withdraw', status: 'approved' } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
                var tft = await Transaction.aggregate([{ $match: { type: 'transfer_sent', status: 'completed' } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
                var today = new Date(); today.setHours(0, 0, 0, 0);
                var tp = await Transaction.aggregate([{ $match: { type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' }, c: { $sum: 1 } } }]);
                var de = await Setting.findOne({ key: 'depositEnabled' });
                var we = await Setting.findOne({ key: 'withdrawEnabled' });
                var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
                var fee = await Setting.findOne({ key: 'fundTransferFee' });
                var m = '📊 *DASHBOARD*\n\n';
                m += '👥 Users: ' + tu + ' | Active Plans: ' + ap + '\n';
                m += '⏳ Pending Dep: ' + pd + ' | WD: ' + pw + '\n';
                m += '💰 Total Dep: PKR ' + (td[0]?.t || 0).toLocaleString() + '\n';
                m += '💸 Total WD: PKR ' + (tw[0]?.t || 0).toLocaleString() + '\n';
                m += '🔄 Total TF: PKR ' + (tft[0]?.t || 0).toLocaleString() + '\n';
                m += '💎 Today Profit: PKR ' + (tp[0]?.t || 0).toLocaleString() + ' (' + (tp[0]?.c || 0) + 'x)\n\n';
                m += '⚙️ Deposit: ' + (de?.value !== false ? '✅' : '❌') + ' | Withdraw: ' + (we?.value !== false ? '✅' : '❌') + ' | Transfer: ' + (fte?.value !== false ? '✅' : '❌') + ' | TF Fee: ' + (fee?.value || 0) + '%';
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            } else if (a === 'users') {
                var users = await User.find().sort({ createdAt: -1 }).limit(20).lean();
                var m = '👥 *USERS (' + (await User.countDocuments()) + ')*\n\n';
                users.forEach(function(u, i) {
                    m += (i + 1) + '. ' + (u.status === 'blocked' ? '🔴' : '🟢') + ' ' + u.username + ' | PID:' + u.pid + ' | PKR ' + (u.balance || 0).toFixed(2) + '\n';
                });
                m += '\nClick Search to find specific user';
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            } else if (a === 'deps') {
                await handlePendingTransactions('deposit', cid, q.message.message_id);
            } else if (a === 'wds') {
                await handlePendingTransactions('withdraw', cid, q.message.message_id);
            } else if (a === 'plans') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();
                var m = '📋 *PLANS*\n\n';
                plans.forEach(function(p) {
                    var tr = p.amount * (p.dailyProfit / 100) * p.duration;
                    m += (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name + ' | PKR ' + p.amount.toLocaleString() + ' | ' + p.dailyProfit + '% | ' + p.duration + 'd\n   💎 Return: PKR ' + tr.toLocaleString() + '\n\n';
                });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add Plan', callback_data: 'addp' }, { text: '🗑️ Delete Plan', callback_data: 'delp' }], [{ text: '🔄 Toggle Plan', callback_data: 'togp' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'addp') {
                sessions[cid] = { s: 'addp' };
                await bot.sendMessage(cid, '➕ *ADD PLAN*\n\nSend: Name | Amount | Profit% | Days\nExample: Premium | 5000 | 12 | 60\n\n/cancel', { parse_mode: 'Markdown' });
            } else if (a === 'delp') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();
                var btns = plans.map(function(p) { return [{ text: '🗑️ ' + p.planId + '. ' + p.name, callback_data: 'delp_' + p.planId }]; });
                btns.push([{ text: '🔙 Back', callback_data: 'plans' }]);
                await bot.editMessageText('Select plan to delete:', { chat_id: cid, message_id: q.message.message_id, reply_markup: { inline_keyboard: btns } });
            } else if (a === 'togp') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();
                var btns = plans.map(function(p) { return [{ text: (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name, callback_data: 'togp_' + p.planId }]; });
                btns.push([{ text: '🔙 Back', callback_data: 'plans' }]);
                await bot.editMessageText('Toggle plan:', { chat_id: cid, message_id: q.message.message_id, reply_markup: { inline_keyboard: btns } });
            } else if (a.startsWith('delp_')) {
                var pid = parseInt(a.split('_')[1]);
                await Plan.deleteOne({ planId: pid });
                await bot.sendMessage(cid, '✅ Plan deleted!', mainMenu());
            } else if (a.startsWith('togp_')) {
                var pid = parseInt(a.split('_')[1]);
                var p = await Plan.findOne({ planId: pid });
                if (p) { p.isActive = !p.isActive; await p.save(); }
                await bot.sendMessage(cid, '✅ Toggled!', mainMenu());
            } else if (a === 'ftset') {
                var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
                var fee = await Setting.findOne({ key: 'fundTransferFee' });
                var m = '🔄 *FUND TRANSFER*\n\nStatus: ' + (fte?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\nFee: ' + (fee?.value || 0) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: (fte?.value !== false ? '❌ Disable' : '✅ Enable'), callback_data: 'tftoggle' }], [{ text: '💰 Set Fee %', callback_data: 'ftfee' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'tftoggle') {
                var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
                var nv = fte?.value !== false ? false : true;
                await Setting.findOneAndUpdate({ key: 'fundTransferEnabled' }, { value: nv }, { upsert: true });
                await bot.sendMessage(cid, '✅ Fund Transfer ' + (nv ? 'Enabled' : 'Disabled') + '!', mainMenu());
            } else if (a === 'ftfee') {
                sessions[cid] = { s: 'ftfee' };
                await bot.sendMessage(cid, '💰 Send fee % (0-100):\n/cancel');
            } else if (a === 'accs') {
                var ep = await Setting.findOne({ key: 'easypaisaNumber' });
                var jc = await Setting.findOne({ key: 'jazzcashNumber' });
                var m = '🏦 *ACCOUNTS*\n\nEasypaisa: ' + (ep?.value || 'N/A') + '\nJazzCash: ' + (jc?.value || 'N/A');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📱 Update Easypaisa', callback_data: 'setep' }], [{ text: '💼 Update JazzCash', callback_data: 'setjc' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'setep') {
                sessions[cid] = { s: 'setep' };
                await bot.sendMessage(cid, '📱 Send: Number | Title\nExample: 03001234567 | Ali\n/cancel');
            } else if (a === 'setjc') {
                sessions[cid] = { s: 'setjc' };
                await bot.sendMessage(cid, '💼 Send: Number | Title\nExample: 03009876543 | Ali\n/cancel');
            } else if (a === 'sett') {
                var mi = await Setting.findOne({ key: 'minWithdraw' });
                var ma = await Setting.findOne({ key: 'maxWithdraw' });
                var da = await Setting.findOne({ key: 'maxDailyWithdraw' });
                var de = await Setting.findOne({ key: 'depositEnabled' });
                var we = await Setting.findOne({ key: 'withdrawEnabled' });
                var m = '⚙️ *SETTINGS*\n\nMin WD: PKR ' + (mi?.value || 30).toLocaleString() + '\nMax WD: PKR ' + (ma?.value || 500000).toLocaleString() + '\nDaily: PKR ' + (da?.value || 100000).toLocaleString() + '\nDeposits: ' + (de?.value !== false ? '✅' : '❌') + '\nWithdrawals: ' + (we?.value !== false ? '✅' : '❌');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Min WD', callback_data: 'sminwd' }, { text: '📝 Max WD', callback_data: 'smaxwd' }], [{ text: '📝 Daily WD', callback_data: 'sdailywd' }], [{ text: (de?.value !== false ? '❌' : '✅') + ' Toggle Deposit', callback_data: 'togdep' }], [{ text: (we?.value !== false ? '❌' : '✅') + ' Toggle Withdraw', callback_data: 'togwd' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'sminwd') { sessions[cid] = { s: 'sminwd' }; await bot.sendMessage(cid, 'Send min withdrawal:\n/cancel'); }
            else if (a === 'smaxwd') { sessions[cid] = { s: 'smaxwd' }; await bot.sendMessage(cid, 'Send max withdrawal:\n/cancel'); }
            else if (a === 'sdailywd') { sessions[cid] = { s: 'sdailywd' }; await bot.sendMessage(cid, 'Send daily limit:\n/cancel'); }
            else if (a === 'togdep') { var de = await Setting.findOne({ key: 'depositEnabled' }); var nv = de?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'depositEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(cid, '✅ Deposits ' + (nv ? 'Enabled' : 'Disabled'), mainMenu()); }
            else if (a === 'togwd') { var we = await Setting.findOne({ key: 'withdrawEnabled' }); var nv = we?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'withdrawEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(cid, '✅ Withdrawals ' + (nv ? 'Enabled' : 'Disabled'), mainMenu()); }
            else if (a === 'ref') {
                var r = await Setting.findOne({ key: 'referralBonus' });
                var m = '🔗 *REFERRAL*\n\nBonus: ' + (r?.value || 11) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Change Bonus %', callback_data: 'sref' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'sref') { sessions[cid] = { s: 'sref' }; await bot.sendMessage(cid, 'Send bonus % (0-100):\n/cancel'); }
            else if (a === 'faq') {
                var faqs = await FAQ.find().sort({ order: 1 }).lean();
                var m = '❓ *FAQs (' + faqs.length + ')*\n\n';
                if (!faqs.length) m += 'None\n\n';
                else faqs.forEach(function(f, i) { m += (i + 1) + '. ' + f.question + '\n\n'; });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add FAQ', callback_data: 'addfaq' }], [{ text: '🗑️ Delete All', callback_data: 'clrfaq' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            } else if (a === 'addfaq') { sessions[cid] = { s: 'addfaq' }; await bot.sendMessage(cid, 'Send: Question | Answer\n/cancel'); }
            else if (a === 'clrfaq') { await FAQ.deleteMany({}); await bot.sendMessage(cid, '✅ All FAQs deleted!', mainMenu()); }
            else if (a === 'bcast') { sessions[cid] = { s: 'bcast' }; await bot.sendMessage(cid, '📢 Send message:\n/cancel'); }
            else if (a === 'search') { sessions[cid] = { s: 'search' }; await bot.sendMessage(cid, '🔍 Send username or PID:\n/cancel'); }
            else if (a.startsWith('ad_') || a.startsWith('rd_')) { await processTransaction(a, 'deposit', cid, mainMenu); }
            else if (a.startsWith('aw_') || a.startsWith('rw_')) { await processTransaction(a, 'withdraw', cid, mainMenu); }
        } catch (e) { console.error(e); bot.sendMessage(cid, '❌ Error: ' + e.message); }
    });

    bot.on('message', async function(msg) {
        var cid = msg.chat.id.toString();
        if (cid !== adminId || !msg.text) return;
        var text = msg.text.trim();
        var s = sessions[cid];
        if (text === '/cancel') { delete sessions[cid]; return bot.sendMessage(cid, '❌ Cancelled', mainMenu()); }

        if (s && s.s === 'addp') {
            var parts = text.split('|').map(function(x) { return x.trim(); });
            if (parts.length < 4) return bot.sendMessage(cid, '❌ Format: Name | Amount | Profit% | Days');
            var lp = await Plan.findOne().sort({ planId: -1 });
            await new Plan({ planId: (lp?.planId || 0) + 1, name: parts[0], amount: parseInt(parts[1]), dailyProfit: parseFloat(parts[2]), duration: parseInt(parts[3]) }).save();
            delete sessions[cid]; return bot.sendMessage(cid, '✅ Plan added!', mainMenu());
        }
        if (s && s.s === 'ftfee') { var v = parseFloat(text); if (isNaN(v) || v < 0 || v > 100) return bot.sendMessage(cid, '❌ (0-100)'); await Setting.findOneAndUpdate({ key: 'fundTransferFee' }, { value: v }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ TF Fee: ' + v + '%', mainMenu()); }
        if (s && s.s === 'setep') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Number | Title'); await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: p[1] }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Updated!', mainMenu()); }
        if (s && s.s === 'setjc') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Number | Title'); await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: p[1] }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Updated!', mainMenu()); }
        if (s && s.s === 'sminwd') { await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Min WD: PKR ' + text, mainMenu()); }
        if (s && s.s === 'smaxwd') { await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Max WD: PKR ' + text, mainMenu()); }
        if (s && s.s === 'sdailywd') { await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Daily: PKR ' + text, mainMenu()); }
        if (s && s.s === 'sref') { await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: parseFloat(text) }, { upsert: true }); delete sessions[cid]; return bot.sendMessage(cid, '✅ Ref Bonus: ' + text + '%', mainMenu()); }
        if (s && s.s === 'addfaq') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Question | Answer'); await new FAQ({ question: p[0], answer: p[1], order: await FAQ.countDocuments() + 1 }).save(); delete sessions[cid]; return bot.sendMessage(cid, '✅ FAQ added!', mainMenu()); }
        if (s && s.s === 'bcast') { var users = await User.find({ status: 'active' }).lean(); var cnt = 0; for (var i = 0; i < users.length; i++) { try { await bot.sendMessage(users[i]._id, '📢 *Admin*\n\n' + text, { parse_mode: 'Markdown' }); cnt++; } catch (e) { } } delete sessions[cid]; return bot.sendMessage(cid, '✅ Sent to ' + cnt + '/' + users.length, mainMenu()); }
        if (s && s.s === 'search') {
            var u = await User.findOne({ $or: [{ username: text }, { pid: text }] }).lean();
            if (!u) { delete sessions[cid]; return bot.sendMessage(cid, '❌ Not found!', mainMenu()); }
            delete sessions[cid];
            var pi = u.activePlan?.planId ? u.activePlan.name + ' (Day ' + u.activePlan.profitDays + '/60)' : 'None';
            var um = '👤 *' + u.username + '*\n🆔 PID: ' + u.pid + '\n📱 ' + u.whatsapp + '\n📊 ' + (u.status === 'active' ? '🟢 Active' : '🔴 Blocked') + '\n💰 PKR ' + (u.balance || 0).toFixed(2) + '\n📋 ' + pi + '\n💵 Inv: PKR ' + (u.totalInvested || 0).toLocaleString() + '\n💎 Earn: PKR ' + (u.totalEarned || 0).toLocaleString() + '\n💸 WD: PKR ' + (u.totalWithdrawn || 0).toLocaleString() + '\n🎁 Ref: PKR ' + (u.referralEarnings || 0).toLocaleString() + '\n🔗 ' + (await User.countDocuments({ referredBy: u.referralCode })) + ' refs';
            var kb = { reply_markup: { inline_keyboard: [[{ text: u.status === 'active' ? '🔴 Block' : '🟢 Unblock', callback_data: 'ub_' + u.username }]] } };
            return bot.sendMessage(cid, um, { parse_mode: 'Markdown', ...kb });
        }
    });
}

async function handlePendingTransactions(type, cid, msgId) {
    var items = await Transaction.find({ type: type, status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean();
    if (!items.length) return bot.editMessageText('✅ No pending ' + type + 's', { chat_id: cid, message_id: msgId });
    await bot.deleteMessage(cid, msgId);
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var u = await User.findOne({ username: it.username }).lean();
        var m = '';
        if (type === 'deposit') {
            m = '💰 *DEPOSIT*\n👤 ' + it.username + ' | PID:' + (u?.pid || '') + '\n💵 PKR ' + it.amount.toLocaleString() + '\n📋 ' + (it.planName || 'Plan ' + it.planId) + '\n🏦 ' + it.accountType + '\n🔢 ' + it.txId + '\n📅 ' + new Date(it.createdAt).toLocaleString();
        } else {
            m = '💸 *WITHDRAWAL*\n👤 ' + it.username + ' | PID:' + (u?.pid || '') + '\n💰 Bal: PKR ' + (u?.balance || 0).toFixed(2) + '\n💵 PKR ' + it.amount.toLocaleString() + '\n🏦 ' + it.accountType + ': ' + it.accountNumber + '\n📛 ' + it.accountTitle + '\n📅 ' + new Date(it.createdAt).toLocaleString();
        }
        var prefix = type === 'deposit' ? 'd' : 'w';
        var kb = { reply_markup: { inline_keyboard: [[{ text: '✅ APPROVE', callback_data: 'a' + prefix + '_' + it._id }, { text: '❌ REJECT', callback_data: 'r' + prefix + '_' + it._id }]] } };
        if (type === 'deposit' && it.screenshot && fs.existsSync(it.screenshot)) {
            try { await bot.sendPhoto(cid, it.screenshot, { caption: m, parse_mode: 'Markdown', ...kb }); } catch (e) { await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); }
        } else { await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); }
    }
}

async function processTransaction(action, type, cid, menuFn) {
    var parts = action.split('_');
    var st = (parts[0] === 'ad' || parts[0] === 'aw') ? 'approved' : 'rejected';
    var tid = parts[1];
    var tx = await Transaction.findById(tid);
    if (!tx) return bot.sendMessage(cid, '❌ Not found');
    tx.status = st;
    tx.processedAt = new Date();
    await tx.save();

    if (st === 'approved' && type === 'deposit') {
        var u = await User.findOne({ username: tx.username });
        var p = await Plan.findOne({ planId: tx.planId });
        if (u && p) {
            u.activePlan = { planId: p.planId, name: p.name, amount: p.amount, dailyProfit: p.amount * (p.dailyProfit / 100), startDate: new Date(), endDate: new Date(Date.now() + p.duration * 86400000), profitDays: 0 };
            u.totalInvested += p.amount;
            var fp = p.amount * (p.dailyProfit / 100);
            u.balance += fp; u.totalEarned += fp; u.activePlan.profitDays += 1;
            await u.save();
            await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: fp, status: 'approved' }).save();
            if (u.referredBy) {
                var ref = await User.findOne({ referralCode: u.referredBy });
                if (ref) {
                    var bp = await Setting.findOne({ key: 'referralBonus' });
                    var bonus = p.amount * ((bp?.value || 11) / 100);
                    ref.balance += bonus; ref.referralEarnings += bonus;
                    await ref.save();
                    await new Transaction({ userId: ref._id, username: ref.username, type: 'referral', amount: bonus, status: 'approved' }).save();
                    bot.sendMessage(cid, '🎁 Bonus PKR ' + bonus + ' → ' + ref.username);
                }
            }
        }
    }
    if (st === 'approved' && type === 'withdraw') {
        var u = await User.findOne({ username: tx.username });
        if (u) { u.totalWithdrawn += tx.amount; u.pendingWithdrawal = false; await u.save(); }
    }
    if (st === 'rejected' && type === 'withdraw') {
        var u = await User.findOne({ username: tx.username });
        if (u) {
            tx.refundAt = new Date(Date.now() + 3600000);
            await tx.save();
            bot.sendMessage(cid, 'ℹ️ Refund after 1 hour for ' + u.username);
            setTimeout(async function() {
                try {
                    u.balance += tx.amount;
                    u.pendingWithdrawal = false;
                    await u.save();
                    tx.status = 'refunded';
                    await tx.save();
                    await new Transaction({ userId: u._id, username: u.username, type: 'refund', amount: tx.amount, status: 'completed' }).save();
                    bot.sendMessage(cid, '✅ Refund PKR ' + tx.amount.toLocaleString() + ' → ' + u.username);
                } catch (e) { }
            }, 3600000);
        }
    }
    bot.sendMessage(cid, '✅ ' + type.toUpperCase() + ' ' + st.toUpperCase() + '!', menuFn());
}

async function notifyAdmin(msg) {
    if (bot && process.env.TELEGRAM_ADMIN_ID) {
        try { await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, msg, { parse_mode: 'HTML' }); } catch (e) { }
    }
}

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
    var token = req.headers.authorization;
    if (!token) return res.status(401).json({ success: false, error: 'Login required' });
    try { req.userId = jwt.verify(token, process.env.JWT_SECRET).userId; next(); } catch (e) { res.status(401).json({ success: false, error: 'Invalid token' }); }
}

// ============ API ROUTES ============

app.get('/api/health', function(req, res) { res.json({ success: true, time: new Date().toISOString() }); });

// Signup
app.post('/api/signup', async function(req, res) {
    try {
        var username = req.body.username, whatsapp = req.body.whatsapp, password = req.body.password, referralCode = req.body.referralCode;
        if (!username || !whatsapp || !password) return res.status(400).json({ success: false, error: 'All fields required' });
        if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be 6+ characters' });
        if (await User.findOne({ username: username })) return res.status(400).json({ success: false, error: 'Username already taken' });
        var pid = generatePID(whatsapp);
        var existingPID = await User.findOne({ pid: pid });
        if (existingPID) pid = pid + Math.floor(Math.random() * 9);
        var hashed = await bcrypt.hash(password, 10);
        var user = new User({ username: username, whatsapp: whatsapp, password: hashed, pid: pid, referralCode: pid, referredBy: referralCode || null });
        await user.save();
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        await notifyAdmin('🆕 <b>New User</b>\n👤 ' + username + '\n🆔 PID: ' + pid + '\n📱 ' + whatsapp);
        res.status(201).json({ success: true, token: token, username: user.username, pid: user.pid });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Registration failed' }); }
});

// Login
app.post('/api/login', async function(req, res) {
    try {
        var username = req.body.username, password = req.body.password;
        if (!username || !password) return res.status(400).json({ success: false, error: 'All fields required' });
        var user = await User.findOne({ username: username });
        if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        if (user.status === 'blocked') return res.status(403).json({ success: false, error: 'Account blocked' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token: token, username: user.username, pid: user.pid, balance: user.balance });
    } catch (e) { res.status(500).json({ success: false, error: 'Login failed' }); }
});

// Dashboard
app.get('/api/dashboard', auth, async function(req, res) {
    var user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var tp = await Transaction.aggregate([{ $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
    var pendDep = await Transaction.countDocuments({ userId: user._id, type: 'deposit', status: 'pending' });
    var pendWd = await Transaction.countDocuments({ userId: user._id, type: 'withdraw', status: 'pending' });
    res.json({
        success: true,
        username: user.username, pid: user.pid, profilePic: user.profilePic,
        balance: user.balance || 0, activePlan: user.activePlan || null,
        totalInvested: user.totalInvested || 0, totalEarned: user.totalEarned || 0,
        referralEarnings: user.referralEarnings || 0, totalWithdrawn: user.totalWithdrawn || 0,
        referralCount: await User.countDocuments({ referredBy: user.referralCode }),
        referralCode: user.referralCode, todayProfit: tp[0]?.t || 0,
        pendingDeposits: pendDep, pendingWithdrawals: pendWd, pendingWithdrawal: user.pendingWithdrawal
    });
});

// Plans
app.get('/api/plans', auth, async function(req, res) {
    res.json({ success: true, plans: await Plan.find({ isActive: true }).sort({ planId: 1 }).lean() });
});

// Deposit Accounts
app.get('/api/deposit-accounts', auth, async function(req, res) {
    var epN = await Setting.findOne({ key: 'easypaisaNumber' });
    var epT = await Setting.findOne({ key: 'easypaisaTitle' });
    var jcN = await Setting.findOne({ key: 'jazzcashNumber' });
    var jcT = await Setting.findOne({ key: 'jazzcashTitle' });
    res.json({
        success: true,
        easypaisa: { number: epN?.value || 'N/A', title: epT?.value || 'N/A' },
        jazzcash: { number: jcN?.value || 'N/A', title: jcT?.value || 'N/A' }
    });
});

// Deposit
app.post('/api/deposit', auth, upload.single('screenshot'), async function(req, res) {
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
        await notifyAdmin('💰 <b>NEW DEPOSIT</b>\n👤 ' + user.username + '\n🆔 PID: ' + user.pid + '\n💵 PKR ' + plan.amount.toLocaleString() + '\n📋 ' + plan.name + '\n🏦 ' + accountType + '\n🔢 ' + txId);
        if (bot) { try { await bot.sendPhoto(process.env.TELEGRAM_ADMIN_ID, req.file.path, { caption: '📸 ' + user.username }); } catch (e) { } }
        res.json({ success: true, message: 'Deposit submitted! Awaiting approval.' });
    } catch (e) { res.status(500).json({ success: false, error: 'Error' }); }
});

// Withdraw
app.post('/api/withdraw', auth, async function(req, res) {
    try {
        var we = await Setting.findOne({ key: 'withdrawEnabled' });
        if (we?.value === false) return res.status(400).json({ success: false, error: 'Withdrawals are temporarily disabled' });
        var accountType = req.body.accountType, accountNumber = req.body.accountNumber, accountTitle = req.body.accountTitle, amount = parseFloat(req.body.amount);
        if (!accountType || !accountNumber || !accountTitle || !amount) return res.status(400).json({ success: false, error: 'All fields required' });
        var user = await User.findById(req.userId);
        if (!user.activePlan?.planId) return res.status(400).json({ success: false, error: 'No active plan. Invest first!' });
        if (user.pendingWithdrawal) return res.status(400).json({ success: false, error: 'You have a pending withdrawal. Wait for it to be processed.' });
        if (user.balance < amount) return res.status(400).json({ success: false, error: 'Insufficient balance' });
        var minW = await Setting.findOne({ key: 'minWithdraw' });
        if (amount < (minW?.value || 30)) return res.status(400).json({ success: false, error: 'Min: PKR ' + (minW?.value || 30) });
        user.balance -= amount;
        user.pendingWithdrawal = true;
        await user.save();
        var tx = new Transaction({ userId: req.userId, username: user.username, type: 'withdraw', amount: amount, accountType: accountType, accountNumber: accountNumber, accountTitle: accountTitle });
        await tx.save();
        await notifyAdmin('💸 <b>NEW WITHDRAWAL</b>\n👤 ' + user.username + '\n🆔 PID: ' + user.pid + '\n💵 PKR ' + amount.toLocaleString() + '\n🏦 ' + accountType + ': ' + accountNumber + '\n📛 ' + accountTitle);
        res.json({ success: true, message: 'Withdrawal submitted! Amount deducted from balance.' });
    } catch (e) { res.status(500).json({ success: false, error: 'Error' }); }
});

// Fund Transfer
app.post('/api/fund-transfer', auth, async function(req, res) {
    try {
        var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
        if (fte?.value === false) return res.status(400).json({ success: false, error: 'Fund Transfer is temporarily disabled' });
        var receiverPid = req.body.receiverPid, amount = parseFloat(req.body.amount);
        if (!receiverPid || !amount) return res.status(400).json({ success: false, error: 'Receiver PID and Amount required' });
        var sender = await User.findById(req.userId);
        if (!sender.activePlan?.planId) return res.status(400).json({ success: false, error: 'No active plan. Invest first!' });
        var feeSetting = await Setting.findOne({ key: 'fundTransferFee' });
        var feePercent = feeSetting?.value || 0;
        var feeAmount = amount * (feePercent / 100);
        var totalDeduct = amount + feeAmount;
        if (sender.balance < totalDeduct) return res.status(400).json({ success: false, error: 'Insufficient balance (including fee: PKR ' + feeAmount.toFixed(2) + ')' });
        var receiver = await User.findOne({ pid: receiverPid });
        if (!receiver) return res.status(400).json({ success: false, error: 'Receiver PID not found' });
        if (receiver._id.toString() === sender._id.toString()) return res.status(400).json({ success: false, error: 'Cannot transfer to yourself' });
        sender.balance -= totalDeduct;
        receiver.balance += amount;
        await sender.save();
        await receiver.save();
        await new Transaction({ userId: sender._id, username: sender.username, type: 'transfer_sent', amount: amount, fee: feeAmount, status: 'completed', relatedUserId: receiver._id, relatedUsername: receiver.username }).save();
        await new Transaction({ userId: receiver._id, username: receiver.username, type: 'transfer_received', amount: amount, status: 'completed', relatedUserId: sender._id, relatedUsername: sender.username }).save();
        res.json({ success: true, message: 'Transfer successful!', senderBalance: sender.balance, fee: feeAmount, receiverUsername: receiver.username });
    } catch (e) { res.status(500).json({ success: false, error: 'Transfer failed' }); }
});

// Verify PID
app.post('/api/verify-pid', auth, async function(req, res) {
    var receiver = await User.findOne({ pid: req.body.pid }).select('username whatsapp pid profilePic').lean();
    if (!receiver) return res.status(404).json({ success: false, error: 'PID not found' });
    res.json({ success: true, user: receiver });
});

// Profile
app.get('/api/profile', auth, async function(req, res) {
    var user = await User.findById(req.userId).select('username whatsapp pid profilePic createdAt').lean();
    res.json({ success: true, user: user });
});

app.put('/api/profile', auth, uploadDP.single('profilePic'), async function(req, res) {
    var user = await User.findById(req.userId);
    if (req.body.whatsapp) { user.whatsapp = req.body.whatsapp; user.pid = generatePID(req.body.whatsapp); user.referralCode = user.pid; }
    if (req.body.password) { if (req.body.password.length < 6) return res.status(400).json({ success: false, error: 'Password must be 6+ characters' }); user.password = await bcrypt.hash(req.body.password, 10); }
    if (req.file) user.profilePic = '/uploads/' + req.file.filename;
    await user.save();
    res.json({ success: true, message: 'Profile updated', user: { username: user.username, pid: user.pid, whatsapp: user.whatsapp, profilePic: user.profilePic } });
});

// Transactions
app.get('/api/transactions', auth, async function(req, res) {
    res.json({ success: true, transactions: await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean() });
});

app.get('/api/deposits', auth, async function(req, res) {
    res.json({ success: true, deposits: await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(50).lean() });
});

app.get('/api/withdrawals', auth, async function(req, res) {
    res.json({ success: true, withdrawals: await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(50).lean() });
});

// Team
app.get('/api/team', auth, async function(req, res) {
    var user = await User.findById(req.userId);
    var team = await User.find({ referredBy: user.referralCode }).select('username pid totalInvested totalEarned createdAt').sort({ createdAt: -1 }).lean();
    res.json({ success: true, teamCount: team.length, team: team });
});

// Leaderboard
app.get('/api/leaderboard', auth, async function(req, res) {
    var ti = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username pid totalInvested').lean();
    var tr = await User.aggregate([{ $match: { status: 'active' } }, { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'r' } }, { $project: { username: 1, pid: 1, c: { $size: '$r' } } }, { $sort: { c: -1 } }, { $limit: 10 }]);
    res.json({ success: true, topInvestors: ti, topReferrers: tr });
});

// FAQs
app.get('/api/faqs', async function(req, res) {
    res.json({ success: true, faqs: await FAQ.find().sort({ order: 1 }).lean() });
});

// Settings (public)
app.get('/api/settings', async function(req, res) {
    var settings = await Setting.find({}).lean();
    var result = {};
    settings.forEach(function(s) { result[s.key] = s.value; });
    res.json({ success: true, settings: result });
});

// AI Chatbot
app.post('/api/chat', async function(req, res) {
    var msg = (req.body.message || '').toLowerCase();
    var reply = '';
    if (msg.includes('invest') || msg.includes('deposit') || msg.includes('plan')) reply = 'To invest: Go to Deposit → Select a plan → Choose Easypaisa or JazzCash → Send payment → Upload screenshot with Transaction ID → Submit. Admin will review and approve.';
    else if (msg.includes('profit') || msg.includes('earning') || msg.includes('return')) reply = 'You earn 11% daily profit for 60 days. Example: PKR 360 investment = PKR 39.60 daily × 60 days = PKR 2,376 total return. First profit credited immediately after deposit approval.';
    else if (msg.includes('withdraw') || msg.includes('cash')) reply = 'To withdraw: Go to Withdraw → Select Easypaisa or JazzCash → Enter account details → Enter amount (Min: PKR 30) → Submit. Amount deducted immediately.';
    else if (msg.includes('refer') || msg.includes('bonus')) reply = 'Share your PID code as referral. When someone joins and invests, you earn 11% bonus instantly. Example: They invest PKR 10,000, you get PKR 1,100.';
    else if (msg.includes('balance')) reply = 'Your balance is displayed on the Dashboard. You can also view: Today\'s Profit, Total Invested, Total Earned, Referral Bonus, Pending Deposits/Withdrawals, and Total Withdrawn.';
    else if (msg.includes('contact') || msg.includes('support') || msg.includes('help')) reply = 'Use the Support button for: Contact Admin (WhatsApp: +258867532400), Join Support Channel, or use Live Chat.';
    else if (msg.includes('transfer') || msg.includes('send')) reply = 'Use Fund Transfer in the dashboard. Enter receiver\'s PID and amount. Transfer is instant! No admin approval needed.';
    else if (msg.includes('limit') || msg.includes('minimum') || msg.includes('maximum')) reply = 'Min withdrawal: PKR 30. Max per request: PKR 500,000. Daily limit: PKR 100,000. Fund Transfer has no limit.';
    else if (msg.includes('password') || msg.includes('profile') || msg.includes('update')) reply = 'Go to Profile to update your password, WhatsApp number, or profile picture. Your PID is auto-generated from your WhatsApp number.';
    else if (msg.includes('hi') || msg.includes('hello') || msg.includes('hey')) reply = 'Hello! 👋 Welcome to Profit 24 Support. How can I help you? Ask about: Plans, Deposits, Withdrawals, Referrals, Fund Transfer, or Account.';
    else if (msg.includes('thank')) reply = 'You\'re welcome! 😊 Feel free to ask if you need anything else.';
    else reply = 'I can help with Profit 24 related questions only. Try asking about: Investment Plans, Deposit Process, Withdrawals, Profit Calculation, Referral System, Fund Transfer, or Account Management.';
    res.json({ success: true, reply: reply });
});

// ============ CRON ============
cron.schedule('0 0 * * *', async function() {
    var users = await User.find({ 'activePlan.planId': { $exists: true }, 'activePlan.endDate': { $gte: new Date() }, 'activePlan.profitDays': { $lt: 60 }, status: 'active' });
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        u.balance += u.activePlan.dailyProfit;
        u.totalEarned += u.activePlan.dailyProfit;
        u.activePlan.profitDays += 1;
        await u.save();
        await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: u.activePlan.dailyProfit, status: 'approved' }).save();
    }
});

// ============ INIT ============
async function init() {
    if (await Plan.countDocuments() === 0) {
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
    if (await Setting.countDocuments() === 0) {
        await Setting.insertMany([
            { key: 'referralBonus', value: 11 },
            { key: 'minWithdraw', value: 30 },
            { key: 'maxWithdraw', value: 500000 },
            { key: 'maxDailyWithdraw', value: 100000 },
            { key: 'easypaisaNumber', value: '03000000000' },
            { key: 'easypaisaTitle', value: 'Profit 24' },
            { key: 'jazzcashNumber', value: '03000000000' },
            { key: 'jazzcashTitle', value: 'Profit 24' },
            { key: 'depositEnabled', value: true },
            { key: 'withdrawEnabled', value: true },
            { key: 'fundTransferEnabled', value: true },
            { key: 'fundTransferFee', value: 0 }
        ]);
    }
    if (await FAQ.countDocuments() === 0) {
        await FAQ.insertMany([
            { question: 'What is Profit 24?', answer: 'Profit 24 is a secure investment platform where you can invest your money and earn 11% daily profit for 60 days. We offer 11 different investment plans starting from PKR 360 up to PKR 50,000+.', order: 1 },
            { question: 'How to create an account?', answer: 'Click on "Create Account", enter your username, WhatsApp number, and password. You can also add a referral code if someone invited you. Click Sign Up and your account will be created instantly. Your PID is auto-generated from your WhatsApp number.', order: 2 },
            { question: 'How to invest?', answer: '1) Login to your account 2) Go to Deposit 3) Select an investment plan 4) Choose payment method (Easypaisa or JazzCash) 5) Send the payment to the given account 6) Upload screenshot with Transaction ID 7) Wait for admin approval.', order: 3 },
            { question: 'How to make a deposit?', answer: 'Select your plan, choose Easypaisa or JazzCash, send the exact plan amount to the provided account number, save the transaction ID, upload payment screenshot, and submit. Your deposit will be reviewed by admin.', order: 4 },
            { question: 'What payment methods are accepted?', answer: 'We accept Easypaisa and JazzCash. You can choose either method when making a deposit. Account details are provided on the deposit page.', order: 5 },
            { question: 'How long does deposit approval take?', answer: 'Deposits are usually approved within a few minutes to a few hours. You will receive your first profit immediately after approval. You will be notified via the platform.', order: 6 },
            { question: 'How do I withdraw funds?', answer: 'Go to Withdraw, select payment method (Easypaisa/JazzCash), enter your account number and account title, enter the amount (Min: PKR 30), and submit. Amount will be deducted from balance immediately and processed by admin. You can only have one pending withdrawal at a time.', order: 7 },
            { question: 'What is the minimum withdrawal?', answer: 'Minimum withdrawal is PKR 30 per request. Maximum withdrawal is PKR 500,000 per request with a daily limit of PKR 100,000.', order: 8 },
            { question: 'What is the maximum withdrawal?', answer: 'You can withdraw up to PKR 500,000 per single request. Daily withdrawal limit is PKR 100,000. You must have an active plan to withdraw.', order: 9 },
            { question: 'How does the referral system work?', answer: 'Share your PID code as referral. When someone joins using your referral link and makes a deposit, you earn 11% of their investment amount as bonus instantly. Example: If they invest PKR 10,000, you get PKR 1,100 bonus. Find your PID in the Profile page.', order: 10 },
            { question: 'When are profits credited?', answer: 'Your first day profit is credited immediately after deposit approval. After that, daily profit is credited automatically at 12:00 AM midnight for 60 days. You can track all profits in Transaction History.', order: 11 },
            { question: 'How is profit calculated?', answer: 'You earn 11% daily profit on your investment amount. Example: PKR 360 investment = PKR 39.60 daily profit × 60 days = PKR 2,376 total return. PKR 50,000 = PKR 5,500 daily × 60 = PKR 330,000 total.', order: 12 },
            { question: 'How long does the investment plan last?', answer: 'All investment plans run for 60 days. You receive daily profit for the entire 60-day period. After 60 days, the plan expires and you can invest in a new plan.', order: 13 },
            { question: 'Can I have multiple active plans?', answer: 'No, you can only have one active plan at a time. You must wait for your current plan to complete (60 days) before investing in a new plan.', order: 14 },
            { question: 'What if my deposit is rejected?', answer: 'If your deposit is rejected by admin, your investment will not be activated. Please contact support on WhatsApp for assistance and provide correct information.', order: 15 },
            { question: 'What if my withdrawal is rejected?', answer: 'If your withdrawal is rejected, the amount will be automatically refunded to your balance after 1 hour. You can then submit a new withdrawal request.', order: 16 },
            { question: 'How to check my balance?', answer: 'Your balance is shown on the Dashboard right after login. You can see: Total Balance, Today\'s Profit, Total Invested, Total Earned, Referral Bonus, Pending Deposits, Pending Withdrawals, and Total Withdrawn.', order: 17 },
            { question: 'Is my account secure?', answer: 'Yes, your account is protected with encrypted password and secure JWT authentication. Never share your password with anyone. Use the Profile page to update your details.', order: 18 },
            { question: 'How to contact support?', answer: 'Click the Support button on the website for three options: 1) Contact Admin via WhatsApp (+258867532400) 2) Join Support Channel 3) Live Chat with AI Assistant for instant answers.', order: 19 },
            { question: 'What are the platform rules?', answer: 'One account per user, one active plan at a time, valid transaction ID required for deposits, accurate account details for withdrawals, referral bonus only on first investment of referred users, no self-transfers allowed.', order: 20 }
        ]);
    }
}

// ============ START SERVER ============
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/profit24')
    .then(async function() {
        console.log('✅ MongoDB Connected');
        await init();
        initBot();
        app.listen(PORT, function() {
            console.log('🚀 Server running on port ' + PORT);
            console.log('🌐 http://localhost:' + PORT);
        });
    })
    .catch(function(e) {
        console.error('❌ MongoDB Error:', e.message);
        process.exit(1);
    });
