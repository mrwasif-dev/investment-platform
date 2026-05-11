// ============================================================
// PROFIT 24 - COMPLETE FRONTEND APP
// All features: Auth, Dashboard, Deposit, Withdraw, 
// Fund Transfer, Profile, History, Leaderboard, FAQ, Chat
// ============================================================

var API = '';
var token = localStorage.getItem('p24_token') || null;
var selPlan = null;
var selPayment = null;
var accounts = null;

function $(id) { return document.getElementById(id); }

function toast(msg, type) {
    type = type || 'i';
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 4000);
}

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US'); }

function hideAll() {
    var ids = ['authSection', 'dashSection', 'plansSection', 'paymentSection', 'depositSection', 'withSection', 'transferSection', 'histSection', 'profileSection', 'leadSection', 'faqSection'];
    ids.forEach(function(id) { var el = $(id); if (el) el.classList.add('hidden'); });
}

function goDash() { hideAll(); $('dashSection').classList.remove('hidden'); loadDash(); }

// Auth Functions
function showSignup() { $('loginCard').classList.add('hidden'); $('signupCard').classList.remove('hidden'); }
function showLogin() { $('signupCard').classList.add('hidden'); $('loginCard').classList.remove('hidden'); }

function doSignup() {
    var u = $('signupUser').value.trim(), w = $('signupWA').value.trim(), p = $('signupPass').value.trim(), r = $('signupRef').value.trim();
    if (!u || !w || !p) return toast('All fields required', 'e');
    if (p.length < 6) return toast('Password: 6+ chars', 'e');
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/signup', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
        try { var d = JSON.parse(x.responseText); if (d.success) { token = d.token; localStorage.setItem('p24_token', token); goDash(); toast('Welcome! 🎉', 's'); } else toast(d.error, 'e'); } catch(e) { toast('Error', 'e'); }
    };
    x.send(JSON.stringify({ username: u, whatsapp: w, password: p, referralCode: r }));
}

function doLogin() {
    var u = $('loginUser').value.trim(), p = $('loginPass').value.trim();
    if (!u || !p) return toast('All fields required', 'e');
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/login', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
        try { var d = JSON.parse(x.responseText); if (d.success) { token = d.token; localStorage.setItem('p24_token', token); goDash(); toast('Welcome! 👋', 's'); } else toast(d.error, 'e'); } catch(e) { toast('Error', 'e'); }
    };
    x.send(JSON.stringify({ username: u, password: p }));
}

function doLogout() { localStorage.removeItem('p24_token'); token = null; hideAll(); $('authSection').classList.remove('hidden'); showLogin(); toast('Logged out', 'i'); }

// Dashboard
function loadDash() {
    if (!token) { hideAll(); $('authSection').classList.remove('hidden'); return; }
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/dashboard', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) {
                $('dashUser').textContent = '👋 ' + d.username;
                $('dashPID').textContent = d.pid || '---';
                $('dashBal').textContent = (d.balance || 0).toFixed(2);
                $('sToday').textContent = 'PKR ' + fmt(d.todayProfit);
                $('sInv').textContent = 'PKR ' + fmt(d.totalInvested);
                $('sEarn').textContent = 'PKR ' + fmt(d.totalEarned);
                $('sRefs').textContent = d.referralCount || 0;
                $('sRefBonus').textContent = 'PKR ' + fmt(d.referralEarnings);
                $('sDepPen').textContent = d.pendingDeposits || 0;
                $('sWdPen').textContent = d.pendingWithdrawals || 0;
                $('sWdTotal').textContent = 'PKR ' + fmt(d.totalWithdrawn);
                $('refLink').textContent = location.origin + '?ref=' + d.referralCode;
                if (d.profilePic) { $('dashDP').src = d.profilePic; $('dashDP').style.display = 'block'; }
                // Update withdraw balance display
                $('wdBalance').textContent = 'PKR ' + (d.balance || 0).toFixed(2);
                $('tfBalance').textContent = 'PKR ' + (d.balance || 0).toFixed(2);
            }
        } catch(e) { }
    };
    x.send();
}

// Deposit Flow
function goDeposit() { hideAll(); $('plansSection').classList.remove('hidden'); loadPlans(); }
function goPlans() { hideAll(); $('plansSection').classList.remove('hidden'); loadPlans(); }
function goPayment() { hideAll(); $('paymentSection').classList.remove('hidden'); loadPaymentPage(); }

function loadPlans() {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/plans', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) {
                var h = '';
                d.plans.forEach(function(p) {
                    var tr = p.amount * (p.dailyProfit / 100) * p.duration;
                    h += '<div class="glass plan-card" onclick="pickPlan(' + p.planId + ',' + p.amount + ',\'' + p.name + '\')"><div class="plan-name">' + p.name + '</div><div class="plan-amount">PKR ' + fmt(p.amount) + '</div><div class="plan-info">📈 ' + p.dailyProfit + '% Daily | 📅 ' + p.duration + ' Days</div><div class="plan-info">💎 Total: PKR ' + fmt(tr) + '</div></div>';
                });
                $('plansGrid').innerHTML = h;
            }
        } catch(e) { }
    };
    x.send();
}

function pickPlan(id, amt, name) {
    selPlan = { id: id, amt: amt, name: name };
    document.querySelectorAll('.plan-card').forEach(function(c) { c.classList.remove('selected'); });
    if (event && event.target) { var c = event.target.closest('.plan-card'); if (c) c.classList.add('selected'); }
    setTimeout(function() { hideAll(); $('paymentSection').classList.remove('hidden'); loadPaymentPage(); }, 300);
}

function loadPaymentPage() {
    if (!selPlan) return goPlans();
    $('payPlanName').textContent = selPlan.name;
    $('payPlanAmt').textContent = fmt(selPlan.amt);
}

function selectPayment(method) {
    selPayment = method;
    hideAll();
    $('depositSection').classList.remove('hidden');
    $('depMethod').textContent = method.toUpperCase();
    loadAccInfo(method);
}

function loadAccInfo(method) {
    if (accounts) { showAccInfo(method); return; }
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/deposit-accounts', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try { var d = JSON.parse(x.responseText); if (d.success) { accounts = d; showAccInfo(method); } } catch(e) { }
    };
    x.send();
}

function showAccInfo(method) {
    var a = accounts[method];
    $('accInfo').innerHTML = '<div class="glass" style="padding:18px;"><p>📱 <strong>' + method.toUpperCase() + '</strong></p><p>🔢 Number: <strong>' + a.number + '</strong> <button class="btn-sm" onclick="navigator.clipboard.writeText(\'' + a.number + '\');toast(\'Copied!\',\'s\')">📋 Copy</button></p><p>📛 Title: <strong>' + a.title + '</strong></p></div>';
}

function submitDeposit() {
    if (!selPlan || !selPayment) return toast('Select plan & method', 'e');
    var tx = $('depTx').value.trim(), fi = $('depSS').files[0];
    if (!tx || !fi) return toast('TxID + Screenshot required', 'e');
    var fd = new FormData();
    fd.append('planId', selPlan.id); fd.append('accountType', selPayment); fd.append('txId', tx); fd.append('screenshot', fi);
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/deposit', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try { var d = JSON.parse(x.responseText); if (d.success) { toast('Deposit submitted! ✅', 's'); goDash(); } else toast(d.error, 'e'); } catch(e) { toast('Error', 'e'); }
    };
    x.send(fd);
}

// Withdraw
function goWithdraw() { hideAll(); $('withSection').classList.remove('hidden'); loadDash(); }

function submitWithdraw() {
    var t = $('wdType').value, n = $('wdNum').value.trim(), ti = $('wdTitle').value.trim(), a = parseFloat($('wdAmt').value);
    if (!t || !n || !ti || !a) return toast('All fields required', 'e');
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/withdraw', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try { var d = JSON.parse(x.responseText); if (d.success) { toast('Withdrawal submitted! Amount deducted. ✅', 's'); goDash(); } else toast(d.error, 'e'); } catch(e) { toast('Error', 'e'); }
    };
    x.send(JSON.stringify({ accountType: t, accountNumber: n, accountTitle: ti, amount: a }));
}

// Fund Transfer
function goTransfer() { hideAll(); $('transferSection').classList.remove('hidden'); loadDash(); $('tfConfirm').classList.add('hidden'); }

function verifyPID() {
    var pid = $('tfPID').value.trim(), amt = parseFloat($('tfAmt').value);
    if (!pid || !amt) return toast('PID and Amount required', 'e');
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/verify-pid', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) {
                $('tfConfirm').classList.remove('hidden');
                $('tfConfirm').innerHTML = '<div class="glass" style="padding:20px;margin-top:15px;"><h3>✅ Receiver Found</h3><p>👤 <strong>' + d.user.username + '</strong></p><p>📱 ' + d.user.whatsapp + '</p><p>🆔 PID: ' + d.user.pid + '</p><p style="color:#fbbf24;font-size:20px;font-weight:900;">Amount: PKR ' + fmt(amt) + '</p><button class="btn" onclick="confirmTransfer(\'' + pid + '\',' + amt + ')">✅ Confirm Transfer</button></div>';
            } else toast(d.error, 'e');
        } catch(e) { toast('Error', 'e'); }
    };
    x.send(JSON.stringify({ pid: pid }));
}

function confirmTransfer(pid, amt) {
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/fund-transfer', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) { toast('✅ Transfer successful!', 's'); goDash(); }
            else toast(d.error, 'e');
        } catch(e) { toast('Error', 'e'); }
    };
    x.send(JSON.stringify({ receiverPid: pid, amount: amt }));
}

// View Plan
function viewPlan() {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/dashboard', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success && d.activePlan && d.activePlan.planId) {
                var p = d.activePlan;
                toast('📋 ' + p.name + '\n💰 Daily: PKR ' + p.dailyProfit.toFixed(2) + '\n📅 Day: ' + p.profitDays + '/60\n💵 Remaining: ' + (60 - p.profitDays) + ' days', 'i');
            } else toast('No active plan. Invest first!', 'e');
        } catch(e) { }
    };
    x.send();
}

// History
function goHistory(type) { hideAll(); $('histSection').classList.remove('hidden'); loadHistory(type); }

function loadHistory(type) {
    var title = type === 'deposits' ? '📥 Deposit History' : type === 'withdrawals' ? '📤 Withdrawal History' : '📊 Transaction History';
    var url = type === 'deposits' ? '/api/deposits' : type === 'withdrawals' ? '/api/withdrawals' : '/api/transactions';
    $('histTitle').textContent = title;
    var x = new XMLHttpRequest();
    x.open('GET', API + url, true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            var items = d.deposits || d.withdrawals || d.transactions || [];
            $('histContent').innerHTML = renderHistory(items);
        } catch(e) { $('histContent').innerHTML = '<p>Error loading data</p>'; }
    };
    x.send();
}

function renderHistory(items) {
    if (!items || !items.length) return '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:40px;">No records found</p>';
    var h = '';
    items.forEach(function(it) {
        var sc = 'status-' + (it.status === 'completed' ? 'completed' : it.status);
        var si = it.status === 'approved' || it.status === 'completed' ? '✅' : it.status === 'rejected' ? '❌' : '⏳';
        var rd = new Date(it.createdAt);
        var pd = it.processedAt ? new Date(it.processedAt) : null;
        var rt = rd.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + rd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        var pt = pd ? pd.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + pd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '---';
        var tl = it.type === 'deposit' ? '📥 DEPOSIT' : it.type === 'withdraw' ? '📤 WITHDRAWAL' : it.type === 'profit' ? '💎 PROFIT' : it.type === 'referral' ? '🎁 REFERRAL' : it.type === 'transfer_sent' ? '🔄 TRANSFER SENT' : it.type === 'transfer_received' ? '🔄 TRANSFER RECEIVED' : it.type === 'refund' ? '↩️ REFUND' : it.type.toUpperCase();
        h += '<div class="hist-card"><div class="hist-header"><span class="hist-type">' + tl + '</span><span class="hist-status ' + sc + '">' + si + ' ' + it.status.toUpperCase() + '</span></div><div class="hist-body">';
        h += '<div class="hist-item"><span class="hist-label">Amount</span><span class="hist-value amount">PKR ' + fmt(it.amount) + '</span></div>';
        if (it.fee > 0) h += '<div class="hist-item"><span class="hist-label">Fee</span><span class="hist-value" style="color:#f87171;">PKR ' + fmt(it.fee) + '</span></div>';
        if (it.accountType) h += '<div class="hist-item"><span class="hist-label">Method</span><span class="hist-value">' + it.accountType.toUpperCase() + '</span></div>';
        if (it.txId) h += '<div class="hist-item"><span class="hist-label">Transaction ID</span><span class="hist-value" style="font-size:11px;word-break:break-all;">' + it.txId + '</span></div>';
        if (it.planName) h += '<div class="hist-item"><span class="hist-label">Plan</span><span class="hist-value">' + it.planName + '</span></div>';
        if (it.relatedUsername) h += '<div class="hist-item"><span class="hist-label">' + (it.type === 'transfer_sent' ? 'Receiver' : 'Sender') + '</span><span class="hist-value">' + it.relatedUsername + '</span></div>';
        h += '</div><div class="hist-timeline"><span>📅 Requested:<br><strong>' + rt + '</strong></span><span>' + (it.status === 'pending' ? '⏳' : '✅') + ' Processed:<br><strong>' + pt + '</strong></span></div></div>';
    });
    return h;
}

// Team
function goTeam() { hideAll(); $('histSection').classList.remove('hidden'); loadTeam(); }

function loadTeam() {
    $('histTitle').textContent = '👥 My Team';
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/team', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            var h = '<p style="margin-bottom:20px;font-size:18px;">👥 Total Members: <strong>' + (d.teamCount || 0) + '</strong></p>';
            if (d.team && d.team.length) {
                d.team.forEach(function(m) {
                    h += '<div class="hist-card"><div class="hist-header"><span class="hist-type">👤 ' + m.username + '</span><span style="color:rgba(255,255,255,0.5);font-size:12px;">PID: ' + (m.pid || '---') + '</span></div><div class="hist-body"><div class="hist-item"><span class="hist-label">Invested</span><span class="hist-value amount">PKR ' + fmt(m.totalInvested) + '</span></div><div class="hist-item"><span class="hist-label">Joined</span><span class="hist-value">' + new Date(m.createdAt).toLocaleDateString() + '</span></div></div></div>';
                });
            }
            $('histContent').innerHTML = h;
        } catch(e) { }
    };
    x.send();
}

// Profile
function goProfile() {
    hideAll(); $('profileSection').classList.remove('hidden');
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/profile', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) {
                $('pfPID').textContent = d.user.pid;
                $('pfWA').value = d.user.whatsapp || '';
                if (d.user.profilePic) { $('profileDP').src = d.user.profilePic; $('profileDP').style.display = 'block'; }
            }
        } catch(e) { }
    };
    x.send();
}

function updateProfile() {
    var fd = new FormData();
    var wa = $('pfWA').value.trim();
    var pass = $('pfPass').value.trim();
    var dp = $('pfDP').files[0];
    if (wa) fd.append('whatsapp', wa);
    if (pass) fd.append('password', pass);
    if (dp) fd.append('profilePic', dp);
    if (!wa && !pass && !dp) return toast('No changes', 'e');
    var x = new XMLHttpRequest();
    x.open('PUT', API + '/api/profile', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.success) { toast('Profile updated! ✅', 's'); goDash(); }
            else toast(d.error, 'e');
        } catch(e) { toast('Error', 'e'); }
    };
    x.send(fd);
}

// Leaderboard
function goLeaderboard() { hideAll(); $('leadSection').classList.remove('hidden'); loadLeaderboard(); }

function loadLeaderboard() {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/leaderboard', true);
    x.setRequestHeader('Authorization', token);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            var h1 = '', h2 = '';
            if (d.topInvestors) d.topInvestors.forEach(function(u, i) { h1 += '<p>' + (i + 1) + '. 🏅 ' + u.username + ' - PKR ' + fmt(u.totalInvested) + '</p>'; });
            if (d.topReferrers) d.topReferrers.forEach(function(u, i) { h2 += '<p>' + (i + 1) + '. 🔗 ' + u.username + ' - ' + (u.c || 0) + ' refs</p>'; });
            $('topInv').innerHTML = h1 || '<p>No data</p>';
            $('topRef').innerHTML = h2 || '<p>No data</p>';
        } catch(e) { }
    };
    x.send();
}

// FAQ
function goFAQ() { hideAll(); $('faqSection').classList.remove('hidden'); loadFAQ(); }

function loadFAQ() {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/faqs', true);
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            if (d.faqs && d.faqs.length) {
                var h = '';
                d.faqs.forEach(function(f, i) {
                    h += '<div class="glass form-card" style="margin:14px 0;animation:fadeIn 0.4s ease;animation-delay:' + (i * 0.08) + 's;"><h3 style="color:#a78bfa;margin-bottom:10px;">❓ ' + f.question + '</h3><p style="color:rgba(255,255,255,0.7);line-height:1.6;">' + f.answer + '</p></div>';
                });
                $('faqContent').innerHTML = h;
            } else $('faqContent').innerHTML = '<p style="text-align:center;padding:30px;color:rgba(255,255,255,0.5);">No FAQs available</p>';
        } catch(e) { }
    };
    x.send();
}

// Support
function openSupport() { $('supportModal').classList.remove('hidden'); }
function closeSupport() { $('supportModal').classList.add('hidden'); }

// Chat
function openChat() { closeSupport(); $('chatWidget').classList.remove('hidden'); }
function closeChat() { $('chatWidget').classList.add('hidden'); }

function sendChat() {
    var input = $('chatInput');
    var msg = input.value.trim();
    if (!msg) return;
    // Add user message
    var body = $('chatBody');
    body.innerHTML += '<div class="chat-msg user">' + msg + '</div>';
    input.value = '';
    body.scrollTop = body.scrollHeight;
    // Call API
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/chat', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
        try {
            var d = JSON.parse(x.responseText);
            body.innerHTML += '<div class="chat-msg bot">' + d.reply + '</div>';
            body.scrollTop = body.scrollHeight;
        } catch(e) { }
    };
    x.send(JSON.stringify({ message: msg }));
}

// Copy Referral
function copyRef() { navigator.clipboard.writeText($('refLink').textContent); toast('Link copied! 📋', 's'); }

// Init
if (token) { hideAll(); $('dashSection').classList.remove('hidden'); loadDash(); }
else { hideAll(); $('authSection').classList.remove('hidden'); showLogin(); }
