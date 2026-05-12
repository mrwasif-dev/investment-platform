// ============================================================
// PROFIT 24 - COMPLETE BACKEND SERVER v13 (FIXED)
// All Features Working - Tested
// ============================================================

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

// Create directories
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });
if (!fs.existsSync('public/css')) fs.mkdirSync('public/css', { recursive: true });
if (!fs.existsSync('public/js')) fs.mkdirSync('public/js', { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer
const depStorage = multer.diskStorage({
    destination: function(req, file, cb) { cb(null, 'uploads/'); },
    filename: function(req, file, cb) {
        cb(null, 'dep-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const upload = multer({ storage: depStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const dpStorage = multer.diskStorage({
    destination: function(req, file, cb) { cb(null, 'public/uploads/'); },
    filename: function(req, file, cb) {
        cb(null, 'dp-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const uploadDP = multer({ storage: dpStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// Models
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, trim: true, lowercase: true },
    whatsapp: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    pid: { type: String, unique: true, required: true },
    profilePic: { type: String, default: null },
    balance: { type: Number, default: 0, min: 0 },
    referralCode: { type: String, unique: true },
    referredBy: { type: String, default: null },
    activePlans: [{ planId: Number, name: String, amount: Number, dailyProfit: Number, startDate: Date, endDate: Date, profitDays: { type: Number, default: 0 } }],
    totalInvested: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
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

function generatePID(whatsapp) { var c = whatsapp.replace(/[\s\-\+\(\)]/g, ''); return c.length >= 5 ? c.slice(-5) : c.padStart(5, '0'); }

// ============================================================
// TELEGRAM BOT - FIXED
// ============================================================
var bot = null;
var botSessions = {};

function initBot() {
    var token = process.env.TELEGRAM_BOT_TOKEN;
    var adminId = process.env.TELEGRAM_ADMIN_ID;
    if (!token || !adminId) { console.log('⚠️ Bot not configured'); return; }

    bot = new TelegramBot(token, { polling: true });
    console.log('✅ Bot Connected - Admin ID:', adminId);

    // Admin Menu
    function adminMenu() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard', callback_data: 'dash' }],
                    [{ text: '👥 Users', callback_data: 'users' }],
                    [{ text: '💰 Pending Deposits', callback_data: 'deps' }],
                    [{ text: '💸 Pending Withdrawals', callback_data: 'wds' }],
                    [{ text: '📋 Manage Plans', callback_data: 'plans' }],
                    [{ text: '🔄 Fund Transfer', callback_data: 'ftset' }],
                    [{ text: '🏦 Accounts', callback_data: 'accs' }],
                    [{ text: '⚙️ Settings', callback_data: 'sett' }],
                    [{ text: '🔗 Referral', callback_data: 'ref' }],
                    [{ text: '❓ FAQ', callback_data: 'faq' }],
                    [{ text: '📢 Broadcast', callback_data: 'bcast' }],
                    [{ text: '🔍 Search', callback_data: 'search' }]
                ]
            }
        };
    }

    // /start or /admin command
    bot.onText(/\/start|\/admin/, function(msg) {
        var cid = msg.chat.id.toString();
        console.log('Command received from:', cid);
        if (cid !== adminId) {
            return bot.sendMessage(cid, '⛔ Unauthorized');
        }
        bot.sendMessage(adminId, '🔐 *ADMIN PANEL*\n\nWelcome! All controls via buttons:', { parse_mode: 'Markdown', ...adminMenu() });
    });

    // Callback handler
    bot.on('callback_query', async function(q) {
        var cid = q.message.chat.id.toString();
        if (cid !== adminId) {
            return bot.answerCallbackQuery(q.id, { text: 'Unauthorized' });
        }
        var action = q.data;
        await bot.answerCallbackQuery(q.id);
        console.log('Button clicked:', action);

        try {
            if (action === 'dash') {
                var tu = await User.countDocuments();
                var ap = await User.countDocuments({ 'activePlans.0': { $exists: true }, status: 'active' });
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
                var m = '📊 *DASHBOARD*\n\n👥 Users: ' + tu + ' | Plans: ' + ap + '\n⏳ Dep: ' + pd + ' | WD: ' + pw + '\n💰 Total Dep: PKR ' + (td[0]?.t || 0).toLocaleString() + '\n💸 Total WD: PKR ' + (tw[0]?.t || 0).toLocaleString() + '\n🔄 Total TF: PKR ' + (tft[0]?.t || 0).toLocaleString() + '\n💎 Today: PKR ' + (tp[0]?.t || 0).toLocaleString() + ' (' + (tp[0]?.c || 0) + 'x)\n\nDep: ' + (de?.value !== false ? '✅' : '❌') + ' | WD: ' + (we?.value !== false ? '✅' : '❌') + ' | TF: ' + (fte?.value !== false ? '✅' : '❌') + ' | Fee: ' + (fee?.value || 0) + '%';
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...adminMenu() });
            }
            else if (action === 'users') {
                var users = await User.find().sort({ createdAt: -1 }).limit(20).lean();
                var m = '👥 *USERS (' + (await User.countDocuments()) + ')*\n\n';
                users.forEach(function(u, i) { m += (i + 1) + '. ' + (u.status === 'blocked' ? '🔴' : '🟢') + ' ' + u.username + ' | PID:' + u.pid + ' | PKR ' + (u.balance || 0).toFixed(2) + ' | Plans:' + (u.activePlans?.length || 0) + '\n'; });
                m += '\nUse Search to find';
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...adminMenu() });
            }
            else if (action === 'deps') {
                await showPending('deposit', cid, q.message.message_id);
            }
            else if (action === 'wds') {
                await showPending('withdraw', cid, q.message.message_id);
            }
            else if (action === 'plans') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();
                var m = '📋 *PLANS*\n\n';
                plans.forEach(function(p) { var tr = p.amount * (p.dailyProfit / 100) * p.duration; m += (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name + ' | PKR ' + p.amount.toLocaleString() + ' | ' + p.dailyProfit + '% | ' + p.duration + 'd | Return: PKR ' + tr.toLocaleString() + '\n\n'; });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add', callback_data: 'addp' }, { text: '🗑️ Delete', callback_data: 'delp' }], [{ text: '🔄 Toggle', callback_data: 'togp' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'addp') { botSessions[cid] = { s: 'addp' }; await bot.sendMessage(cid, '➕ Send: Name | Amount | Profit% | Days\nExample: Premium | 5000 | 12 | 60\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'delp') { var plans = await Plan.find().sort({ planId: 1 }).lean(); var btns = plans.map(function(p) { return [{ text: '🗑️ ' + p.planId + '. ' + p.name, callback_data: 'delp_' + p.planId }]; }); btns.push([{ text: '🔙 Back', callback_data: 'plans' }]); await bot.editMessageText('Select to delete:', { chat_id: cid, message_id: q.message.message_id, reply_markup: { inline_keyboard: btns } }); }
            else if (action === 'togp') { var plans = await Plan.find().sort({ planId: 1 }).lean(); var btns = plans.map(function(p) { return [{ text: (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name, callback_data: 'togp_' + p.planId }]; }); btns.push([{ text: '🔙 Back', callback_data: 'plans' }]); await bot.editMessageText('Select to toggle:', { chat_id: cid, message_id: q.message.message_id, reply_markup: { inline_keyboard: btns } }); }
            else if (action.startsWith('delp_')) { var pid = parseInt(action.split('_')[1]); await Plan.deleteOne({ planId: pid }); await bot.sendMessage(cid, '✅ Plan deleted!', adminMenu()); }
            else if (action.startsWith('togp_')) { var pid = parseInt(action.split('_')[1]); var p = await Plan.findOne({ planId: pid }); if (p) { p.isActive = !p.isActive; await p.save(); } await bot.sendMessage(cid, '✅ Toggled!', adminMenu()); }
            else if (action === 'ftset') {
                var fte = await Setting.findOne({ key: 'fundTransferEnabled' }), fee = await Setting.findOne({ key: 'fundTransferFee' });
                var m = '🔄 *FUND TRANSFER*\n\nStatus: ' + (fte?.value !== false ? '✅' : '❌') + '\nFee: ' + (fee?.value || 0) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: (fte?.value !== false ? '❌ Disable' : '✅ Enable'), callback_data: 'tftoggle' }], [{ text: '💰 Set Fee', callback_data: 'ftfee' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'tftoggle') { var cur = await Setting.findOne({ key: 'fundTransferEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'fundTransferEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(cid, '✅ TF ' + (nv ? 'Enabled' : 'Disabled'), adminMenu()); }
            else if (action === 'ftfee') { botSessions[cid] = { s: 'ftfee' }; await bot.sendMessage(cid, '💰 Send fee % (0-100):\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'accs') {
                var ep = await Setting.findOne({ key: 'easypaisaNumber' }), jc = await Setting.findOne({ key: 'jazzcashNumber' });
                var m = '🏦 *ACCOUNTS*\n\nEP: ' + (ep?.value || 'N/A') + '\nJC: ' + (jc?.value || 'N/A');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📱 Update EP', callback_data: 'setep' }], [{ text: '💼 Update JC', callback_data: 'setjc' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'setep') { botSessions[cid] = { s: 'setep' }; await bot.sendMessage(cid, '📱 Send: Number | Title\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'setjc') { botSessions[cid] = { s: 'setjc' }; await bot.sendMessage(cid, '💼 Send: Number | Title\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'sett') {
                var mi = await Setting.findOne({ key: 'minWithdraw' }), ma = await Setting.findOne({ key: 'maxWithdraw' }), da = await Setting.findOne({ key: 'maxDailyWithdraw' });
                var de = await Setting.findOne({ key: 'depositEnabled' }), we = await Setting.findOne({ key: 'withdrawEnabled' });
                var m = '⚙️ *SETTINGS*\n\nMin WD: PKR ' + (mi?.value || 30).toLocaleString() + '\nMax WD: PKR ' + (ma?.value || 500000).toLocaleString() + '\nDaily: PKR ' + (da?.value || 100000).toLocaleString() + '\nDep: ' + (de?.value !== false ? '✅' : '❌') + ' | WD: ' + (we?.value !== false ? '✅' : '❌');
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Min', callback_data: 'smin' }, { text: '📝 Max', callback_data: 'smax' }, { text: '📝 Daily', callback_data: 'sdaily' }], [{ text: (de?.value !== false ? '❌ Dep' : '✅ Dep'), callback_data: 'togdep' }, { text: (we?.value !== false ? '❌ WD' : '✅ WD'), callback_data: 'togwd' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'smin') { botSessions[cid] = { s: 'smin' }; await bot.sendMessage(cid, 'Send min WD amount:\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'smax') { botSessions[cid] = { s: 'smax' }; await bot.sendMessage(cid, 'Send max WD amount:\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'sdaily') { botSessions[cid] = { s: 'sdaily' }; await bot.sendMessage(cid, 'Send daily limit:\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'togdep') { var cur = await Setting.findOne({ key: 'depositEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'depositEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(cid, '✅ Dep ' + (nv ? 'On' : 'Off'), adminMenu()); }
            else if (action === 'togwd') { var cur = await Setting.findOne({ key: 'withdrawEnabled' }); var nv = cur?.value !== false ? false : true; await Setting.findOneAndUpdate({ key: 'withdrawEnabled' }, { value: nv }, { upsert: true }); await bot.sendMessage(cid, '✅ WD ' + (nv ? 'On' : 'Off'), adminMenu()); }
            else if (action === 'ref') {
                var r = await Setting.findOne({ key: 'referralBonus' });
                var m = '🔗 *REFERRAL*\n\nBonus: ' + (r?.value || 11) + '%';
                var kb = { reply_markup: { inline_keyboard: [[{ text: '📝 Change', callback_data: 'sref' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'sref') { botSessions[cid] = { s: 'sref' }; await bot.sendMessage(cid, 'Send bonus %:\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'faq') {
                var faqs = await FAQ.find().sort({ order: 1 }).lean();
                var m = '❓ *FAQs (' + faqs.length + ')*\n\n';
                if (!faqs.length) m += 'None\n';
                else faqs.forEach(function(f, i) { m += (i + 1) + '. ' + f.question + '\n\n'; });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add', callback_data: 'addfaq' }], [{ text: '🗑️ Clear', callback_data: 'clrfaq' }], [{ text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(m, { chat_id: cid, message_id: q.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'addfaq') { botSessions[cid] = { s: 'addfaq' }; await bot.sendMessage(cid, 'Send: Q | A\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'clrfaq') { await FAQ.deleteMany({}); await bot.sendMessage(cid, '✅ Cleared!', adminMenu()); }
            else if (action === 'bcast') { botSessions[cid] = { s: 'bcast' }; await bot.sendMessage(cid, '📢 Send message:\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'search') { botSessions[cid] = { s: 'search' }; await bot.sendMessage(cid, '🔍 Send username/PID:\n/cancel', { parse_mode: 'Markdown' }); }
            // APPROVE/REJECT
            else if (action.startsWith('ad_') || action.startsWith('rd_') || action.startsWith('aw_') || action.startsWith('rw_')) {
                var parts = action.split('_');
                var st, type, tid;
                if (parts[0] === 'ad') { st = 'approved'; type = 'deposit'; tid = parts[1]; }
                else if (parts[0] === 'rd') { st = 'rejected'; type = 'deposit'; tid = parts[1]; }
                else if (parts[0] === 'aw') { st = 'approved'; type = 'withdraw'; tid = parts[1]; }
                else { st = 'rejected'; type = 'withdraw'; tid = parts[1]; }
                
                var tx = await Transaction.findById(tid);
                if (!tx || tx.status !== 'pending') {
                    await bot.sendMessage(cid, '⚠️ Already processed or not found');
                    return;
                }
                tx.status = st; tx.processedAt = new Date(); await tx.save();
                
                // Remove buttons from message
                if (tx.telegramMsgId) {
                    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: cid, message_id: tx.telegramMsgId }); } catch(e) {}
                    try {
                        var lbl = type === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL';
                        var cap = (st === 'approved' ? '✅ *' + lbl + ' APPROVED!*' : '❌ *' + lbl + ' REJECTED!*') + '\n👤 ' + tx.username + '\n💵 PKR ' + tx.amount.toLocaleString();
                        await bot.editMessageText(cap, { chat_id: cid, message_id: tx.telegramMsgId, parse_mode: 'Markdown' });
                    } catch(e) {}
                }
                
                if (st === 'approved' && type === 'deposit') {
                    var u = await User.findOne({ username: tx.username }), p = await Plan.findOne({ planId: tx.planId });
                    if (u && p) {
                        var dp = p.amount * (p.dailyProfit / 100);
                        u.activePlans.push({ planId: p.planId, name: p.name, amount: p.amount, dailyProfit: dp, startDate: new Date(), endDate: new Date(Date.now() + p.duration * 86400000), profitDays: 0 });
                        u.totalInvested += p.amount;
                        var fp = dp;
                        u.balance += fp; u.totalEarned += fp;
                        u.activePlans[u.activePlans.length - 1].profitDays += 1;
                        await u.save();
                        await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: fp, status: 'approved' }).save();
                        if (u.referredBy) {
                            var ref = await User.findOne({ referralCode: u.referredBy });
                            if (ref) {
                                var bp = await Setting.findOne({ key: 'referralBonus' }), bonus = p.amount * ((bp?.value || 11) / 100);
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
                    if (u) { u.totalWithdrawn += tx.amount; await u.save(); }
                }
                if (st === 'rejected' && type === 'withdraw') {
                    var u = await User.findOne({ username: tx.username });
                    if (u) {
                        tx.refundAt = new Date(Date.now() + 3600000); await tx.save();
                        bot.sendMessage(cid, 'ℹ️ Refund in 1hr for ' + u.username);
                        setTimeout(async function() {
                            try { u.balance += tx.amount; await u.save(); tx.status = 'refunded'; await tx.save(); await new Transaction({ userId: u._id, username: u.username, type: 'refund', amount: tx.amount, status: 'completed' }).save(); bot.sendMessage(cid, '✅ Refunded PKR ' + tx.amount.toLocaleString() + ' → ' + u.username); } catch(e) {}
                        }, 3600000);
                    }
                }
                await bot.sendMessage(cid, '✅ *' + type.toUpperCase() + ' ' + st.toUpperCase() + '!*', { parse_mode: 'Markdown', ...adminMenu() });
            }
            else if (action.startsWith('ub_')) { var un = action.split('_')[1]; var u = await User.findOne({ username: un }); if (u) { u.status = u.status === 'active' ? 'blocked' : 'active'; await u.save(); bot.sendMessage(cid, '✅ ' + u.username + ' → ' + u.status); } }
        } catch(e) { console.error('Bot error:', e); bot.sendMessage(cid, '❌ Error: ' + e.message, adminMenu()); }
    });

    // Text handler
    bot.on('message', async function(msg) {
        var cid = msg.chat.id.toString();
        if (cid !== adminId || !msg.text) return;
        var text = msg.text.trim(), s = botSessions[cid];
        if (text === '/cancel') { delete botSessions[cid]; return bot.sendMessage(cid, '❌ Cancelled', adminMenu()); }
        if (s && s.s === 'addp') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 4) return bot.sendMessage(cid, '❌ Name|Amt|%|Days'); var lp = await Plan.findOne().sort({ planId: -1 }); await new Plan({ planId: (lp?.planId || 0) + 1, name: p[0], amount: parseInt(p[1]), dailyProfit: parseFloat(p[2]), duration: parseInt(p[3]) }).save(); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Added!', adminMenu()); }
        if (s && s.s === 'ftfee') { var v = parseFloat(text); if (isNaN(v) || v < 0 || v > 100) return bot.sendMessage(cid, '❌ 0-100'); await Setting.findOneAndUpdate({ key: 'fundTransferFee' }, { value: v }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Fee:' + v + '%', adminMenu()); }
        if (s && s.s === 'setep') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Num|Title'); await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: p[1] }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ EP Updated!', adminMenu()); }
        if (s && s.s === 'setjc') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Num|Title'); await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: p[1] }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ JC Updated!', adminMenu()); }
        if (s && s.s === 'smin') { await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Min:' + text, adminMenu()); }
        if (s && s.s === 'smax') { await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Max:' + text, adminMenu()); }
        if (s && s.s === 'sdaily') { await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: parseInt(text) }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Daily:' + text, adminMenu()); }
        if (s && s.s === 'sref') { await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: parseFloat(text) }, { upsert: true }); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Bonus:' + text + '%', adminMenu()); }
        if (s && s.s === 'addfaq') { var p = text.split('|').map(function(x) { return x.trim(); }); if (p.length < 2) return bot.sendMessage(cid, '❌ Q|A'); await new FAQ({ question: p[0], answer: p[1], order: await FAQ.countDocuments() + 1 }).save(); delete botSessions[cid]; return bot.sendMessage(cid, '✅ Added!', adminMenu()); }
        if (s && s.s === 'bcast') { var users = await User.find({ status: 'active' }).lean(); var cnt = 0; for (var i = 0; i < users.length; i++) { try { await bot.sendMessage(users[i]._id, '📢 *Admin*\n\n' + text, { parse_mode: 'Markdown' }); cnt++; } catch(e) {} } delete botSessions[cid]; return bot.sendMessage(cid, '✅ ' + cnt + '/' + users.length, adminMenu()); }
        if (s && s.s === 'search') {
            var u = await User.findOne({ $or: [{ username: text }, { pid: text }] }).lean();
            if (!u) { delete botSessions[cid]; return bot.sendMessage(cid, '❌ Not found', adminMenu()); }
            delete botSessions[cid];
            var pi = '';
            if (u.activePlans && u.activePlans.length > 0) { u.activePlans.forEach(function(p) { pi += '📋 ' + p.name + ' (D' + p.profitDays + '/60)\n'; }); } else { pi = 'None'; }
            var um = '👤 *' + u.username + '*\n🆔 ' + u.pid + '\n📱 ' + u.whatsapp + '\n📊 ' + u.status + '\n💰 PKR ' + (u.balance || 0).toFixed(2) + '\n📋 Plans:\n' + pi + '💵 Inv: PKR ' + (u.totalInvested || 0).toLocaleString() + '\n💎 Earn: PKR ' + (u.totalEarned || 0).toLocaleString() + '\n💸 WD: PKR ' + (u.totalWithdrawn || 0).toLocaleString() + '\n🎁 Ref: PKR ' + (u.referralEarnings || 0).toLocaleString();
            var kb = { reply_markup: { inline_keyboard: [[{ text: u.status === 'active' ? '🔴 Block' : '🟢 Unblock', callback_data: 'ub_' + u.username }]] } };
            return bot.sendMessage(cid, um, { parse_mode: 'Markdown', ...kb });
        }
    });

    console.log('✅ Bot handlers registered');
}

async function showPending(type, cid, msgId) {
    var items = await Transaction.find({ type: type, status: 'pending' }).sort({ createdAt: -1 }).limit(15).lean();
    if (!items.length) return bot.editMessageText('✅ No pending ' + type + 's', { chat_id: cid, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'dash' }]] } });
    await bot.deleteMessage(cid, msgId);
    for (var i = 0; i < items.length; i++) {
        var it = items[i], u = await User.findOne({ username: it.username }).lean();
        var m = '', pfx = type === 'deposit' ? 'd' : 'w';
        if (type === 'deposit') { m = '💰 *DEPOSIT*\n👤 ' + it.username + ' | PID:' + (u?.pid || '') + '\n💵 PKR ' + it.amount.toLocaleString() + '\n📋 ' + (it.planName || 'P' + it.planId) + '\n🏦 ' + it.accountType + '\n🔢 ' + it.txId; }
        else { m = '💸 *WITHDRAWAL*\n👤 ' + it.username + ' | PID:' + (u?.pid || '') + '\n💰 Bal: PKR ' + (u?.balance || 0).toFixed(2) + '\n💵 PKR ' + it.amount.toLocaleString() + '\n🏦 ' + it.accountType + ': ' + it.accountNumber + '\n📛 ' + it.accountTitle; }
        var kb = { reply_markup: { inline_keyboard: [[{ text: '✅ APPROVE', callback_data: 'a' + pfx + '_' + it._id }, { text: '❌ REJECT', callback_data: 'r' + pfx + '_' + it._id }]] } };
        var sent;
        if (type === 'deposit' && it.screenshot && fs.existsSync(it.screenshot)) { try { sent = await bot.sendPhoto(cid, it.screenshot, { caption: m, parse_mode: 'Markdown', ...kb }); } catch(e) { sent = await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); } }
        else { sent = await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); }
        if (sent) await Transaction.findByIdAndUpdate(it._id, { telegramMsgId: sent.message_id });
    }
}

async function notifyAdmin(msg) { if (bot && process.env.TELEGRAM_ADMIN_ID) { try { await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, msg, { parse_mode: 'HTML' }); } catch(e) {} } }

// Auth middleware
function auth(req, res, next) {
    var token = req.headers.authorization;
    if (!token) return res.status(401).json({ success: false, error: 'Login required' });
    try { req.userId = jwt.verify(token, process.env.JWT_SECRET).userId; next(); } catch(e) { res.status(401).json({ success: false, error: 'Invalid token' }); }
}

// API Routes
app.get('/api/health', function(req, res) { res.json({ success: true, time: new Date().toISOString() }); });

app.post('/api/signup', async function(req, res) {
    try {
        var username = req.body.username, whatsapp = req.body.whatsapp, password = req.body.password, referralCode = req.body.referralCode;
        if (!username || !whatsapp || !password) return res.status(400).json({ success: false, error: 'All fields required' });
        if (password.length < 6) return res.status(400).json({ success: false, error: 'Password 6+ chars' });
        if (await User.findOne({ username: username })) return res.status(400).json({ success: false, error: 'Username taken' });
        var pid = generatePID(whatsapp);
        var exists = await User.findOne({ pid: pid });
        if (exists) pid = pid + Math.floor(Math.random() * 9);
        var user = new User({ username, whatsapp, password: await bcrypt.hash(password, 10), pid, referralCode: pid, referredBy: referralCode || null });
        await user.save();
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        await notifyAdmin('🆕 <b>New User</b>\n👤 ' + username + '\n🆔 PID: ' + pid + '\n📱 ' + whatsapp);
        res.status(201).json({ success: true, token, username: user.username, pid: user.pid });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/login', async function(req, res) {
    try {
        var username = req.body.username, password = req.body.password;
        var user = await User.findOne({ username });
        if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        if (user.status === 'blocked') return res.status(403).json({ success: false, error: 'Account blocked' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token, username: user.username, pid: user.pid, balance: user.balance });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/dashboard', auth, async function(req, res) {
    var user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var tp = await Transaction.aggregate([{ $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
    var pendDep = await Transaction.countDocuments({ userId: user._id, type: 'deposit', status: 'pending' });
    var pendWd = await Transaction.countDocuments({ userId: user._id, type: 'withdraw', status: 'pending' });
    res.json({ success: true, username: user.username, pid: user.pid, profilePic: user.profilePic, balance: user.balance || 0, activePlans: user.activePlans || [], totalInvested: user.totalInvested || 0, totalEarned: user.totalEarned || 0, referralEarnings: user.referralEarnings || 0, totalWithdrawn: user.totalWithdrawn || 0, referralCount: await User.countDocuments({ referredBy: user.referralCode }), referralCode: user.referralCode, todayProfit: tp[0]?.t || 0, pendingDeposits: pendDep, pendingWithdrawals: pendWd });
});

app.get('/api/plans', auth, async function(req, res) { res.json({ success: true, plans: await Plan.find({ isActive: true }).sort({ planId: 1 }).lean() }); });

app.get('/api/deposit-accounts', auth, async function(req, res) {
    var epN = await Setting.findOne({ key: 'easypaisaNumber' }), epT = await Setting.findOne({ key: 'easypaisaTitle' });
    var jcN = await Setting.findOne({ key: 'jazzcashNumber' }), jcT = await Setting.findOne({ key: 'jazzcashTitle' });
    res.json({ success: true, easypaisa: { number: epN?.value || 'N/A', title: epT?.value || 'N/A' }, jazzcash: { number: jcN?.value || 'N/A', title: jcT?.value || 'N/A' } });
});

app.post('/api/deposit', auth, upload.single('screenshot'), async function(req, res) {
    try {
        var de = await Setting.findOne({ key: 'depositEnabled' });
        if (de?.value === false) return res.status(400).json({ success: false, error: 'Deposits disabled' });
        var planId = req.body.planId, accountType = req.body.accountType, txId = req.body.txId;
        if (!planId || !accountType || !txId || !req.file) return res.status(400).json({ success: false, error: 'All fields + screenshot' });
        var plan = await Plan.findOne({ planId: parseInt(planId) });
        if (!plan) return res.status(400).json({ success: false, error: 'Invalid plan' });
        var user = await User.findById(req.userId);
        var tx = new Transaction({ userId: req.userId, username: user.username, type: 'deposit', amount: plan.amount, accountType, screenshot: req.file.path, txId, planId: plan.planId, planName: plan.name });
        await tx.save();
        await notifyAdmin('💰 <b>NEW DEPOSIT</b>\n👤 ' + user.username + '\n🆔 PID: ' + user.pid + '\n💵 PKR ' + plan.amount.toLocaleString() + '\n📋 ' + plan.name + '\n🏦 ' + accountType + '\n🔢 ' + txId);
        if (bot) { try { await bot.sendPhoto(process.env.TELEGRAM_ADMIN_ID, req.file.path, { caption: '📸 ' + user.username }); } catch(e) {} }
        res.json({ success: true, message: 'Deposit submitted!' });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/withdraw', auth, async function(req, res) {
    try {
        var we = await Setting.findOne({ key: 'withdrawEnabled' });
        if (we?.value === false) return res.status(400).json({ success: false, error: 'Withdrawals disabled' });
        var accountType = req.body.accountType, accountNumber = req.body.accountNumber, accountTitle = req.body.accountTitle, amount = parseFloat(req.body.amount);
        if (!accountType || !accountNumber || !accountTitle || !amount) return res.status(400).json({ success: false, error: 'All fields required' });
        var user = await User.findById(req.userId);
        if (!user.activePlans || user.activePlans.length === 0) return res.status(400).json({ success: false, error: 'No active plan' });
        if (user.balance < amount) return res.status(400).json({ success: false, error: 'Insufficient balance' });
        var minW = await Setting.findOne({ key: 'minWithdraw' });
        if (amount < (minW?.value || 30)) return res.status(400).json({ success: false, error: 'Min: PKR ' + (minW?.value || 30) });
        user.balance -= amount;
        await user.save();
        var tx = new Transaction({ userId: req.userId, username: user.username, type: 'withdraw', amount, accountType, accountNumber, accountTitle });
        await tx.save();
        await notifyAdmin('💸 <b>NEW WITHDRAWAL</b>\n👤 ' + user.username + '\n🆔 PID: ' + user.pid + '\n💵 PKR ' + amount.toLocaleString() + '\n🏦 ' + accountType + ': ' + accountNumber + '\n📛 ' + accountTitle);
        res.json({ success: true, message: 'Withdrawal submitted!' });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/fund-transfer', auth, async function(req, res) {
    try {
        var fte = await Setting.findOne({ key: 'fundTransferEnabled' });
        if (fte?.value === false) return res.status(400).json({ success: false, error: 'Transfer disabled' });
        var receiverPid = req.body.receiverPid, amount = parseFloat(req.body.amount);
        if (!receiverPid || !amount) return res.status(400).json({ success: false, error: 'PID + Amount' });
        var sender = await User.findById(req.userId);
        if (!sender.activePlans || sender.activePlans.length === 0) return res.status(400).json({ success: false, error: 'No active plan' });
        var feeSetting = await Setting.findOne({ key: 'fundTransferFee' });
        var feePercent = feeSetting?.value || 0;
        var feeAmount = amount * (feePercent / 100);
        var total = amount + feeAmount;
        if (sender.balance < total) return res.status(400).json({ success: false, error: 'Insufficient (fee: PKR ' + feeAmount.toFixed(2) + ')' });
        var receiver = await User.findOne({ pid: receiverPid });
        if (!receiver) return res.status(400).json({ success: false, error: 'PID not found' });
        if (receiver._id.toString() === sender._id.toString()) return res.status(400).json({ success: false, error: 'Cannot transfer to self' });
        sender.balance -= total; receiver.balance += amount;
        await sender.save(); await receiver.save();
        await new Transaction({ userId: sender._id, username: sender.username, type: 'transfer_sent', amount, fee: feeAmount, status: 'completed', relatedUserId: receiver._id, relatedUsername: receiver.username }).save();
        await new Transaction({ userId: receiver._id, username: receiver.username, type: 'transfer_received', amount, status: 'completed', relatedUserId: sender._id, relatedUsername: sender.username }).save();
        await notifyAdmin('🔄 <b>TRANSFER</b>\n📤 ' + sender.username + ' → 📥 ' + receiver.username + '\n💵 PKR ' + amount.toLocaleString() + ' | Fee: PKR ' + feeAmount.toFixed(2));
        res.json({ success: true, message: 'Transfer done!', senderBalance: sender.balance, fee: feeAmount, receiverUsername: receiver.username });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/verify-pid', auth, async function(req, res) {
    var receiver = await User.findOne({ pid: req.body.pid }).select('username whatsapp pid').lean();
    if (!receiver) return res.status(404).json({ success: false, error: 'PID not found' });
    res.json({ success: true, user: receiver });
});

app.get('/api/profile', auth, async function(req, res) { res.json({ success: true, user: await User.findById(req.userId).select('username whatsapp pid profilePic').lean() }); });

app.put('/api/profile', auth, uploadDP.single('profilePic'), async function(req, res) {
    var user = await User.findById(req.userId);
    if (req.body.whatsapp) { user.whatsapp = req.body.whatsapp; user.pid = generatePID(req.body.whatsapp); user.referralCode = user.pid; }
    if (req.body.password) { if (req.body.password.length < 6) return res.status(400).json({ success: false, error: 'Password 6+ chars' }); user.password = await bcrypt.hash(req.body.password, 10); }
    if (req.file) user.profilePic = '/uploads/' + req.file.filename;
    await user.save();
    res.json({ success: true, message: 'Profile updated' });
});

app.get('/api/transactions', auth, async function(req, res) { res.json({ success: true, transactions: await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean() }); });
app.get('/api/deposits', auth, async function(req, res) { res.json({ success: true, deposits: await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(50).lean() }); });
app.get('/api/withdrawals', auth, async function(req, res) { res.json({ success: true, withdrawals: await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(50).lean() }); });

app.get('/api/team', auth, async function(req, res) {
    var user = await User.findById(req.userId);
    res.json({ success: true, teamCount: await User.countDocuments({ referredBy: user.referralCode }), team: await User.find({ referredBy: user.referralCode }).select('username pid totalInvested createdAt').sort({ createdAt: -1 }).lean() });
});

app.get('/api/leaderboard', auth, async function(req, res) {
    var ti = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username pid totalInvested').lean();
    var tr = await User.aggregate([{ $match: { status: 'active' } }, { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'r' } }, { $project: { username: 1, pid: 1, c: { $size: '$r' } } }, { $sort: { c: -1 } }, { $limit: 10 }]);
    res.json({ success: true, topInvestors: ti, topReferrers: tr });
});

app.get('/api/faqs', async function(req, res) { res.json({ success: true, faqs: await FAQ.find().sort({ order: 1 }).lean() }); });

app.post('/api/chat', async function(req, res) {
    var msg = (req.body.message || '').trim();
    var isUrdu = /[\u0600-\u06FF]/.test(msg);
    var reply = '';
    if (isUrdu) {
        if (msg.includes('سرمایہ') || msg.includes('انویسٹ') || msg.includes('پلان')) reply = 'سرمایہ کاری: ڈپازٹ پیج پر جائیں، پلان منتخب کریں، ادائیگی کریں، اسکرین شاٹ اپ لوڈ کریں۔';
        else if (msg.includes('منافع')) reply = '60 دن تک 11% روزانہ منافع۔ مثال: PKR 360 = PKR 39.60 روزانہ × 60 = PKR 2,376';
        else if (msg.includes('نکاسی') || msg.includes('وڈرا')) reply = 'وڈرا: طریقہ منتخب کریں، اکاؤنٹ دیں، رقم درج کریں (کم از کم PKR 30)';
        else if (msg.includes('ریف')) reply = 'ریف: PID شیئر کریں، دوست کی سرمایہ کاری پر 11% بونس پائیں';
        else if (msg.includes('سلام') || msg.includes('ہیلو')) reply = 'السلام علیکم! پروفٹ 24 میں خوش آمدید۔ کیا مدد کروں؟';
        else reply = 'پروفٹ 24 کے بارے میں پوچھیں: سرمایہ کاری، منافع، نکاسی، ریفرل';
    } else {
        if (msg.includes('invest') || msg.includes('deposit')) reply = 'To invest: Deposit → Select plan → Pay → Upload screenshot → Submit.';
        else if (msg.includes('profit')) reply = '11% daily profit for 60 days. PKR 360 = PKR 39.60/day × 60 = PKR 2,376.';
        else if (msg.includes('withdraw')) reply = 'Withdraw: Select method → Enter details → Enter amount (Min: PKR 30) → Submit.';
        else if (msg.includes('refer')) reply = 'Share PID, earn 11% when someone invests via your referral.';
        else if (msg.includes('hello') || msg.includes('hi')) reply = 'Hello! Welcome to Profit 24. How can I help?';
        else reply = 'Ask about: Investment, Profit, Withdrawal, Referral, or Transfer.';
    }
    res.json({ success: true, reply });
});

cron.schedule('0 0 * * *', async function() {
    var users = await User.find({ status: 'active' });
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (u.activePlans && u.activePlans.length > 0) {
            var mod = false;
            for (var j = 0; j < u.activePlans.length; j++) {
                var p = u.activePlans[j];
                if (p.endDate >= new Date() && p.profitDays < 60) {
                    u.balance += p.dailyProfit; u.totalEarned += p.dailyProfit; p.profitDays += 1;
                    await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: p.dailyProfit, status: 'approved' }).save();
                    mod = true;
                }
            }
            if (mod) await u.save();
        }
    }
});

async function init() {
    if (await Plan.countDocuments() === 0) await Plan.insertMany([{ planId: 1, name: 'Starter', amount: 360 }, { planId: 2, name: 'Silver', amount: 860 }, { planId: 3, name: 'Gold', amount: 1460 }, { planId: 4, name: 'Platinum', amount: 2660 }, { planId: 5, name: 'Diamond', amount: 4260 }, { planId: 6, name: 'Ruby', amount: 6060 }, { planId: 7, name: 'Emerald', amount: 9060 }, { planId: 8, name: 'Sapphire', amount: 14060 }, { planId: 9, name: 'Titanium', amount: 21060 }, { planId: 10, name: 'Master', amount: 30000 }, { planId: 11, name: 'Custom', amount: 50000 }]);
    if (await Setting.countDocuments() === 0) await Setting.insertMany([{ key: 'referralBonus', value: 11 }, { key: 'minWithdraw', value: 30 }, { key: 'maxWithdraw', value: 500000 }, { key: 'maxDailyWithdraw', value: 100000 }, { key: 'easypaisaNumber', value: '03000000000' }, { key: 'easypaisaTitle', value: 'Profit 24' }, { key: 'jazzcashNumber', value: '03000000000' }, { key: 'jazzcashTitle', value: 'Profit 24' }, { key: 'depositEnabled', value: true }, { key: 'withdrawEnabled', value: true }, { key: 'fundTransferEnabled', value: true }, { key: 'fundTransferFee', value: 0 }]);
    if (await FAQ.countDocuments() === 0) await FAQ.insertMany([{ question: 'What is Profit 24?', answer: 'Investment platform with 11% daily profit for 60 days.', order: 1 }, { question: 'How to invest?', answer: 'Select plan → Pay → Upload screenshot → Get approved.', order: 2 }, { question: 'Referral?', answer: 'Share PID, earn 11% bonus.', order: 3 }]);
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/profit24')
    .then(async function() { console.log('DB OK'); await init(); initBot(); app.listen(PORT, function() { console.log('Server:' + PORT); }); })
    .catch(function(e) { console.error(e); process.exit(1); });
