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

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ============ MODELS ============
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, trim: true },
    whatsapp: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    referralCode: { type: String, unique: true, uppercase: true },
    referredBy: { type: String, default: null },
    activePlan: {
        planId: Number, name: String, amount: Number,
        dailyProfit: Number, startDate: Date, endDate: Date,
        profitDays: { type: Number, default: 0 }
    },
    totalInvested: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    type: { type: String, enum: ['deposit', 'withdraw', 'profit', 'referral'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    accountType: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    accountTitle: { type: String, default: '' },
    screenshot: { type: String, default: null },
    txId: { type: String, default: '' },
    planId: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now }
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

// ============ TELEGRAM BOT ============
let bot = null;
const sessions = {};

function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    if (!token || !adminId) return;

    bot = new TelegramBot(token, { polling: true });
    console.log('Telegram Bot: Connected');

    const mainMenu = () => ({
        reply_markup: {
            inline_keyboard: [
                [{ text: '📊 Dashboard', callback_data: 'dash' }],
                [{ text: '👥 Users', callback_data: 'users' }, { text: '💰 Deposits', callback_data: 'deps' }],
                [{ text: '💸 Withdrawals', callback_data: 'wds' }, { text: '📋 Plans', callback_data: 'plans' }],
                [{ text: '🏦 Accounts', callback_data: 'accs' }, { text: '⚙️ Settings', callback_data: 'sett' }],
                [{ text: '🔗 Referral', callback_data: 'ref' }, { text: '❓ FAQ', callback_data: 'faq' }],
                [{ text: '📢 Broadcast', callback_data: 'bcast' }]
            ]
        }
    });

    const backBtn = { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'dash' }]] } };

    bot.onText(/\/start|\/admin/, function (msg) {
        if (msg.chat.id.toString() !== adminId) return;
        bot.sendMessage(adminId, '🔐 *ADMIN PANEL*\n\nFull Control', { parse_mode: 'Markdown', ...mainMenu() });
    });

    bot.on('callback_query', async function (query) {
        const cid = query.message.chat.id.toString();
        if (cid !== adminId) return bot.answerCallbackQuery(query.id);
        const action = query.data;
        await bot.answerCallbackQuery(query.id);

        try {
            if (action === 'dash') {
                const totalUsers = await User.countDocuments();
                const activePlans = await User.countDocuments({ 'activePlan.planId': { $exists: true }, status: 'active' });
                const pendDeps = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
                const pendWds = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
                const totalDep = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'approved' } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const todayProfit = await Transaction.aggregate([{ $match: { type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' }, c: { $sum: 1 } } }]);
                const msg = '📊 *Dashboard*\n\n👥 Users: ' + totalUsers + ' | Active Plans: ' + activePlans + '\n⏳ Pending Dep: ' + pendDeps + ' | WD: ' + pendWds + '\n💰 Total Dep: PKR ' + (totalDep[0]?.t || 0).toLocaleString() + '\n💎 Today Profit: PKR ' + (todayProfit[0]?.t || 0).toLocaleString() + ' (' + (todayProfit[0]?.c || 0) + ' times)';
                await bot.editMessageText(msg, { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            }
            else if (action === 'users') {
                const users = await User.find().sort({ createdAt: -1 }).limit(25).lean();
                let msg = '👥 *Users* (' + (await User.countDocuments()) + ')\n\n';
                users.forEach(function (u, i) {
                    msg += (i + 1) + '. ' + (u.status === 'blocked' ? '🔴' : '🟢') + ' ' + u.username + ' | PKR ' + (u.totalInvested || 0).toLocaleString() + '\n';
                });
                msg += '\n/user username';
                await bot.editMessageText(msg, { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            }
            else if (action === 'deps') {
                const deps = await Transaction.find({ type: 'deposit', status: 'pending' }).limit(10).lean();
                if (!deps.length) return bot.editMessageText('✅ No pending deposits', { chat_id: cid, message_id: query.message.message_id, ...backBtn });
                await bot.deleteMessage(cid, query.message.message_id);
                for (var i = 0; i < deps.length; i++) {
                    var d = deps[i];
                    var m = '💰 *Deposit*\n👤 ' + d.username + '\n💵 PKR ' + d.amount + '\n🏦 ' + d.accountType + '\n🔢 ' + d.txId + '\n📅 ' + new Date(d.createdAt).toLocaleDateString();
                    var kb = { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'ad_' + d._id }, { text: '❌ Reject', callback_data: 'rd_' + d._id }]] } };
                    if (d.screenshot && fs.existsSync(d.screenshot)) {
                        try { await bot.sendPhoto(cid, d.screenshot, { caption: m, parse_mode: 'Markdown', ...kb }); } catch (e) { await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); }
                    } else { await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb }); }
                }
                await bot.sendMessage(cid, '✅ Done', backBtn);
            }
            else if (action === 'wds') {
                const wds = await Transaction.find({ type: 'withdraw', status: 'pending' }).limit(10).lean();
                if (!wds.length) return bot.editMessageText('✅ No pending withdrawals', { chat_id: cid, message_id: query.message.message_id, ...backBtn });
                await bot.deleteMessage(cid, query.message.message_id);
                for (var i = 0; i < wds.length; i++) {
                    var w = wds[i];
                    var u = await User.findOne({ username: w.username }).lean();
                    var m = '💸 *Withdrawal*\n👤 ' + w.username + '\n💰 Bal: PKR ' + ((u?.balance || 0).toFixed(2)) + '\n💵 PKR ' + w.amount + '\n🏦 ' + w.accountType + ': ' + w.accountNumber + '\n📛 ' + w.accountTitle;
                    var kb = { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'aw_' + w._id }, { text: '❌ Reject', callback_data: 'rw_' + w._id }]] } };
                    await bot.sendMessage(cid, m, { parse_mode: 'Markdown', ...kb });
                }
                await bot.sendMessage(cid, '✅ Done', backBtn);
            }
            else if (action === 'plans') {
                const plans = await Plan.find().sort({ planId: 1 }).lean();
                var msg = '📋 *Plans*\n\n';
                plans.forEach(function (p) { msg += (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name + ' | PKR ' + p.amount + ' | ' + p.dailyProfit + '% | ' + p.duration + 'd\n'; });
                var kb = { reply_markup: { inline_keyboard: [[{ text: '➕ Add', callback_data: 'addp' }, { text: '🗑️ Delete', callback_data: 'delp' }], [{ text: '🔄 Toggle', callback_data: 'togp' }, { text: '🔙 Menu', callback_data: 'dash' }]] } };
                await bot.editMessageText(msg, { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...kb });
            }
            else if (action === 'addp') { sessions[cid] = { s: 'addp' }; await bot.sendMessage(cid, '➕ Send: Name | Amount | Profit% | Days\n/cancel', { parse_mode: 'Markdown' }); }
            else if (action === 'delp') {
                const plans = await Plan.find().sort({ planId: 1 }).lean();
                var btns = plans.map(function (p) { return [{ text: '🗑️ ' + p.planId + '. ' + p.name, callback_data: 'delp_' + p.planId }]; });
                btns.push([{ text: '🔙 Back', callback_data: 'plans' }]);
                await bot.editMessageText('Delete plan:', { chat_id: cid, message_id: query.message.message_id, reply_markup: { inline_keyboard: btns } });
            }
            else if (action === 'togp') {
                const plans = await Plan.find().sort({ planId: 1 }).lean();
                var btns = plans.map(function (p) { return [{ text: (p.isActive ? '✅' : '❌') + ' ' + p.planId + '. ' + p.name, callback_data: 'togp_' + p.planId }]; });
                btns.push([{ text: '🔙 Back', callback_data: 'plans' }]);
                await bot.editMessageText('Toggle plan:', { chat_id: cid, message_id: query.message.message_id, reply_markup: { inline_keyboard: btns } });
            }
            else if (action.startsWith('delp_')) { var pid = parseInt(action.split('_')[1]); await Plan.deleteOne({ planId: pid }); await bot.sendMessage(cid, '✅ Deleted!', mainMenu()); }
            else if (action.startsWith('togp_')) { var pid = parseInt(action.split('_')[1]); var p = await Plan.findOne({ planId: pid }); if (p) { p.isActive = !p.isActive; await p.save(); } await bot.sendMessage(cid, '✅ Toggled!', mainMenu()); }
            else if (action === 'accs') {
                var ep = await Setting.findOne({ key: 'easypaisaNumber' }), jc = await Setting.findOne({ key: 'jazzcashNumber' });
                await bot.editMessageText('🏦 *Accounts*\n\nEasypaisa: ' + (ep?.value || 'N/A') + '\nJazzCash: ' + (jc?.value || 'N/A') + '\n\n/setep num|title\n/setjc num|title', { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            }
            else if (action === 'sett') {
                var mi = await Setting.findOne({ key: 'minWithdraw' }), ma = await Setting.findOne({ key: 'maxWithdraw' }), da = await Setting.findOne({ key: 'maxDailyWithdraw' });
                await bot.editMessageText('⚙️ *Settings*\n\nMin WD: ' + (mi?.value || 30) + '\nMax WD: ' + (ma?.value || 500000) + '\nDaily: ' + (da?.value || 100000) + '\n\n/setminwd | /setmaxwd | /setdailywd', { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            }
            else if (action === 'ref') { var r = await Setting.findOne({ key: 'referralBonus' }); await bot.editMessageText('🔗 *Referral*\n\nBonus: ' + (r?.value || 11) + '%\n\n/setrefbonus', { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() }); }
            else if (action === 'faq') {
                var faqs = await FAQ.find().sort({ order: 1 }).lean();
                var msg = '❓ *FAQs*\n\n';
                if (!faqs.length) msg += 'None\n\n';
                else faqs.forEach(function (f, i) { msg += (i + 1) + '. Q: ' + f.question + '\n   A: ' + f.answer + '\n\n'; });
                msg += '/addfaq Q|A\n/delfaq num\n/clearfaqs';
                await bot.editMessageText(msg, { chat_id: cid, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainMenu() });
            }
            else if (action === 'bcast') { sessions[cid] = { s: 'bcast' }; await bot.sendMessage(cid, '📢 Send message:\n/cancel'); }
            else if (action.startsWith('ad_') || action.startsWith('rd_')) {
                var tid = action.split('_')[1], st = action.startsWith('ad_') ? 'approved' : 'rejected';
                var tx = await Transaction.findById(tid);
                if (!tx) return bot.sendMessage(cid, '❌ Not found');
                tx.status = st; await tx.save();
                if (st === 'approved') {
                    var u = await User.findOne({ username: tx.username }), p = await Plan.findOne({ planId: tx.planId });
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
                bot.sendMessage(cid, '✅ Deposit ' + st + '!', mainMenu());
            }
            else if (action.startsWith('aw_') || action.startsWith('rw_')) {
                var tid = action.split('_')[1], st = action.startsWith('aw_') ? 'approved' : 'rejected';
                var tx = await Transaction.findById(tid);
                if (!tx) return bot.sendMessage(cid, '❌ Not found');
                tx.status = st; await tx.save();
                if (st === 'approved') { var u = await User.findOne({ username: tx.username }); if (u) { u.balance -= tx.amount; await u.save(); } }
                bot.sendMessage(cid, '✅ Withdrawal ' + st + '!', mainMenu());
            }
            else if (action.startsWith('ub_')) {
                var un = action.split('_')[1], u = await User.findOne({ username: un });
                if (u) { u.status = u.status === 'active' ? 'blocked' : 'active'; await u.save(); bot.sendMessage(cid, '✅ ' + un + ' → ' + u.status); }
            }
        } catch (e) { console.error(e); bot.sendMessage(cid, '❌ Error: ' + e.message); }
    });

    bot.on('message', async function (msg) {
        var cid = msg.chat.id.toString();
        if (cid !== adminId || !msg.text) return;
        var text = msg.text.trim(), s = sessions[cid];
        if (text === '/cancel') { delete sessions[cid]; return bot.sendMessage(cid, '❌ Cancelled', mainMenu()); }
        if (s && s.s === 'addp') {
            var parts = text.split('|').map(function (x) { return x.trim(); });
            if (parts.length < 4) return bot.sendMessage(cid, '❌ Format: Name | Amount | Profit% | Days');
            var lp = await Plan.findOne().sort({ planId: -1 });
            await new Plan({ planId: (lp?.planId || 0) + 1, name: parts[0], amount: parseInt(parts[1]), dailyProfit: parseFloat(parts[2]), duration: parseInt(parts[3]) }).save();
            delete sessions[cid];
            return bot.sendMessage(cid, '✅ Plan added!', mainMenu());
        }
        if (s && s.s === 'bcast') {
            var users = await User.find({ status: 'active' }).lean();
            var cnt = 0;
            for (var i = 0; i < users.length; i++) { try { await bot.sendMessage(users[i]._id, '📢 *Admin*\n\n' + text, { parse_mode: 'Markdown' }); cnt++; } catch (e) { } }
            delete sessions[cid];
            return bot.sendMessage(cid, '✅ Sent ' + cnt + '/' + users.length, mainMenu());
        }
        if (text.startsWith('/setep ')) { var p = text.slice(7).split('|').map(function (x) { return x.trim(); }); await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: p[1] || '' }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/setjc ')) { var p = text.slice(7).split('|').map(function (x) { return x.trim(); }); await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: p[0] }, { upsert: true }); await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: p[1] || '' }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/setminwd ')) { await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: parseInt(text.slice(10)) }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/setmaxwd ')) { await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: parseInt(text.slice(10)) }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/setdailywd ')) { await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: parseInt(text.slice(12)) }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/setrefbonus ')) { await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: parseFloat(text.slice(13)) }, { upsert: true }); return bot.sendMessage(cid, '✅ OK'); }
        if (text.startsWith('/addfaq ')) { var p = text.slice(8).split('|').map(function (x) { return x.trim(); }); await new FAQ({ question: p[0], answer: p[1] || '', order: await FAQ.countDocuments() + 1 }).save(); return bot.sendMessage(cid, '✅ FAQ added!'); }
        if (text.startsWith('/delfaq ')) { var n = parseInt(text.slice(8)), faqs = await FAQ.find().sort({ order: 1 }).lean(); if (n > 0 && n <= faqs.length) { await FAQ.findByIdAndDelete(faqs[n - 1]._id); return bot.sendMessage(cid, '✅ Deleted!'); } return bot.sendMessage(cid, '❌ Invalid'); }
        if (text === '/clearfaqs') { await FAQ.deleteMany({}); return bot.sendMessage(cid, '✅ Cleared!'); }
        if (text.startsWith('/user ')) {
            var un = text.slice(6).trim(), u = await User.findOne({ username: un }).lean();
            if (!u) return bot.sendMessage(cid, '❌ Not found');
            var um = '👤 *' + u.username + '*\n📱 ' + u.whatsapp + '\n💰 PKR ' + ((u.balance || 0).toFixed(2)) + '\n📊 ' + u.status + '\n📋 ' + (u.activePlan?.name || 'None') + ' (' + (u.activePlan?.profitDays || 0) + '/60)\n💵 Inv: PKR ' + ((u.totalInvested || 0).toLocaleString()) + '\n💎 Earn: PKR ' + ((u.totalEarned || 0).toLocaleString()) + '\n🔗 ' + (await User.countDocuments({ referredBy: u.referralCode })) + ' refs\n📅 ' + (new Date(u.createdAt).toLocaleDateString());
            var kb = { reply_markup: { inline_keyboard: [[{ text: u.status === 'active' ? '🔴 Block' : '🟢 Unblock', callback_data: 'ub_' + u.username }]] } };
            return bot.sendMessage(cid, um, { parse_mode: 'Markdown', ...kb });
        }
    });
}

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
    var token = req.headers.authorization;
    if (!token) return res.status(401).json({ success: false, error: 'Login required' });
    try { var decoded = jwt.verify(token, process.env.JWT_SECRET); req.userId = decoded.userId; next(); }
    catch (e) { res.status(401).json({ success: false, error: 'Invalid token' }); }
}

// ============ API ROUTES ============
app.get('/api/health', function (req, res) { res.json({ success: true, time: new Date().toISOString() }); });

app.post('/api/signup', async function (req, res) {
    try {
        var username = req.body.username, whatsapp = req.body.whatsapp, password = req.body.password, referralCode = req.body.referralCode;
        if (!username || !whatsapp || !password) return res.status(400).json({ success: false, error: 'All fields required' });
        if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be 6+ characters' });
        var exists = await User.findOne({ username: username });
        if (exists) return res.status(400).json({ success: false, error: 'Username already taken' });
        var hashed = await bcrypt.hash(password, 10);
        var refCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        var user = new User({ username: username, whatsapp: whatsapp, password: hashed, referralCode: refCode, referredBy: referralCode || null });
        await user.save();
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ success: true, token: token, username: user.username, referralCode: user.referralCode });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Registration failed' }); }
});

app.post('/api/login', async function (req, res) {
    try {
        var username = req.body.username, password = req.body.password;
        if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
        var user = await User.findOne({ username: username });
        if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        if (user.status === 'blocked') return res.status(403).json({ success: false, error: 'Account blocked' });
        var valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ success: false, error: 'Invalid credentials' });
        var token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token: token, username: user.username, balance: user.balance });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Login failed' }); }
});

app.get('/api/dashboard', auth, async function (req, res) {
    try {
        var user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ success: false, error: 'Not found' });
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var tp = await Transaction.aggregate([{ $match: { userId: user._id, type: 'profit', status: 'approved', createdAt: { $gte: today } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
        var refCount = await User.countDocuments({ referredBy: user.referralCode });
        res.json({ success: true, username: user.username, balance: user.balance || 0, activePlan: user.activePlan || null, totalInvested: user.totalInvested || 0, totalEarned: user.totalEarned || 0, referralEarnings: user.referralEarnings || 0, referralCount: refCount, referralCode: user.referralCode, todayProfit: tp[0]?.t || 0 });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Error' }); }
});

app.get('/api/plans', auth, async function (req, res) { res.json({ success: true, plans: await Plan.find({ isActive: true }).sort({ planId: 1 }).lean() }); });

app.get('/api/deposit-accounts', auth, async function (req, res) {
    var epN = await Setting.findOne({ key: 'easypaisaNumber' }), epT = await Setting.findOne({ key: 'easypaisaTitle' }), jcN = await Setting.findOne({ key: 'jazzcashNumber' }), jcT = await Setting.findOne({ key: 'jazzcashTitle' });
    res.json({ success: true, easypaisa: { number: epN?.value || 'N/A', title: epT?.value || 'N/A' }, jazzcash: { number: jcN?.value || 'N/A', title: jcT?.value || 'N/A' } });
});

app.post('/api/deposit', auth, upload.single('screenshot'), async function (req, res) {
    try {
        var planId = req.body.planId, accountType = req.body.accountType, txId = req.body.txId;
        if (!planId || !accountType || !txId || !req.file) return res.status(400).json({ success: false, error: 'All fields + screenshot required' });
        var plan = await Plan.findOne({ planId: parseInt(planId) });
        if (!plan) return res.status(400).json({ success: false, error: 'Invalid plan' });
        var user = await User.findById(req.userId);
        await new Transaction({ userId: req.userId, username: user.username, type: 'deposit', amount: plan.amount, accountType: accountType, screenshot: req.file.path, txId: txId, planId: plan.planId }).save();
        res.json({ success: true, message: 'Deposit submitted!' });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Error' }); }
});

app.post('/api/withdraw', auth, async function (req, res) {
    try {
        var accountType = req.body.accountType, accountNumber = req.body.accountNumber, accountTitle = req.body.accountTitle, amount = parseFloat(req.body.amount);
        if (!accountType || !accountNumber || !accountTitle || !amount) return res.status(400).json({ success: false, error: 'All fields required' });
        var user = await User.findById(req.userId);
        if (!user.activePlan?.planId) return res.status(400).json({ success: false, error: 'No active plan' });
        if (user.balance < amount) return res.status(400).json({ success: false, error: 'Insufficient balance' });
        var minW = await Setting.findOne({ key: 'minWithdraw' });
        if (amount < (minW?.value || 30)) return res.status(400).json({ success: false, error: 'Min: PKR ' + (minW?.value || 30) });
        await new Transaction({ userId: req.userId, username: user.username, type: 'withdraw', amount: amount, accountType: accountType, accountNumber: accountNumber, accountTitle: accountTitle }).save();
        res.json({ success: true, message: 'Withdrawal submitted!' });
    } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Error' }); }
});

app.get('/api/transactions', auth, async function (req, res) { res.json({ success: true, transactions: await Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean() }); });
app.get('/api/deposits', auth, async function (req, res) { res.json({ success: true, deposits: await Transaction.find({ userId: req.userId, type: 'deposit' }).sort({ createdAt: -1 }).limit(50).lean() }); });
app.get('/api/withdrawals', auth, async function (req, res) { res.json({ success: true, withdrawals: await Transaction.find({ userId: req.userId, type: 'withdraw' }).sort({ createdAt: -1 }).limit(50).lean() }); });

app.get('/api/team', auth, async function (req, res) {
    var user = await User.findById(req.userId);
    var team = await User.find({ referredBy: user.referralCode }).select('username totalInvested createdAt').sort({ createdAt: -1 }).lean();
    res.json({ success: true, teamCount: team.length, team: team });
});

app.get('/api/leaderboard', auth, async function (req, res) {
    var ti = await User.find({ status: 'active' }).sort({ totalInvested: -1 }).limit(10).select('username totalInvested').lean();
    var tr = await User.aggregate([{ $match: { status: 'active' } }, { $lookup: { from: 'users', localField: 'referralCode', foreignField: 'referredBy', as: 'r' } }, { $project: { username: 1, c: { $size: '$r' } } }, { $sort: { c: -1 } }, { $limit: 10 }]);
    res.json({ success: true, topInvestors: ti, topReferrers: tr });
});

app.get('/api/faqs', async function (req, res) { res.json({ success: true, faqs: await FAQ.find().sort({ order: 1 }).lean() }); });

// ============ CRON ============
cron.schedule('0 0 * * *', async function () {
    var users = await User.find({ 'activePlan.planId': { $exists: true }, 'activePlan.endDate': { $gte: new Date() }, 'activePlan.profitDays': { $lt: 60 }, status: 'active' });
    for (var i = 0; i < users.length; i++) { var u = users[i]; u.balance += u.activePlan.dailyProfit; u.totalEarned += u.activePlan.dailyProfit; u.activePlan.profitDays += 1; await u.save(); await new Transaction({ userId: u._id, username: u.username, type: 'profit', amount: u.activePlan.dailyProfit, status: 'approved' }).save(); }
});

// ============ INIT ============
async function init() {
    if (await Plan.countDocuments() === 0) await Plan.insertMany([{ planId: 1, name: 'Starter', amount: 360 }, { planId: 2, name: 'Silver', amount: 860 }, { planId: 3, name: 'Gold', amount: 1460 }, { planId: 4, name: 'Platinum', amount: 2660 }, { planId: 5, name: 'Diamond', amount: 4260 }, { planId: 6, name: 'Ruby', amount: 6060 }, { planId: 7, name: 'Emerald', amount: 9060 }, { planId: 8, name: 'Sapphire', amount: 14060 }, { planId: 9, name: 'Titanium', amount: 21060 }, { planId: 10, name: 'Master', amount: 30000 }, { planId: 11, name: 'Custom', amount: 50000 }]);
    if (await Setting.countDocuments() === 0) await Setting.insertMany([{ key: 'referralBonus', value: 11 }, { key: 'minWithdraw', value: 30 }, { key: 'maxWithdraw', value: 500000 }, { key: 'maxDailyWithdraw', value: 100000 }, { key: 'easypaisaNumber', value: '03000000000' }, { key: 'easypaisaTitle', value: 'Platform' }, { key: 'jazzcashNumber', value: '03000000000' }, { key: 'jazzcashTitle', value: 'Platform' }]);
    if (await FAQ.countDocuments() === 0) await FAQ.insertMany([{ question: 'How to invest?', answer: 'Select a plan, send payment to given account, upload screenshot with Transaction ID.', order: 1 }, { question: 'When do I get profit?', answer: 'First profit immediately after approval, then daily at 12 AM for 60 days.', order: 2 }, { question: 'Minimum withdrawal?', answer: 'PKR 30 minimum withdrawal.', order: 3 }, { question: 'How does referral work?', answer: 'Share your link, earn 11% bonus when someone joins and invests!', order: 4 }]);
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/profit24')
    .then(async function () { console.log('MongoDB OK'); await init(); initBot(); app.listen(PORT, function () { console.log('Server: ' + PORT); }); })
    .catch(function (e) { console.error(e); process.exit(1); });
