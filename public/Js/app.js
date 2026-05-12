// ============================================================
// PROFIT 24 - COMPLETE FRONTEND APP
// All Features Working
// ============================================================

var API_URL = '';
var authToken = localStorage.getItem('p24_token') || null;
var selectedPlan = null;
var selectedPayment = null;
var accountData = null;

// Utility Functions
function $(id) { return document.getElementById(id); }

function showToast(msg, type) {
    type = type || 'i';
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    t.style.display = 'block';
    setTimeout(function() { t.style.display = 'none'; }, 4000);
}

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US'); }

function hideAllPages() {
    var pages = ['authSection','dashSection','plansSection','paymentSection','depositSection','withdrawSection','transferSection','historySection','profileSection','leaderboardSection','faqSection'];
    for (var i = 0; i < pages.length; i++) { var el = $(pages[i]); if (el) el.classList.add('hidden'); }
}

function goToDashboard() { hideAllPages(); $('dashSection').classList.remove('hidden'); loadDashboardData(); }
function goToPlans() { hideAllPages(); $('plansSection').classList.remove('hidden'); loadPlansList(); }
function goToPayment() { hideAllPages(); $('paymentSection').classList.remove('hidden'); showPaymentPage(); }

// Auth
function showSignupForm() { $('loginCard').classList.add('hidden'); $('signupCard').classList.remove('hidden'); }
function showLoginForm() { $('signupCard').classList.add('hidden'); $('loginCard').classList.remove('hidden'); }

function handleSignup() {
    var u = $('signupUser').value.trim(), w = $('signupWA').value.trim(), p = $('signupPass').value.trim(), r = $('signupRef').value.trim();
    if (!u || !w || !p) return showToast('All fields required', 'e');
    if (p.length < 6) return showToast('Password must be 6+ characters', 'e');
    showToast('Creating account...', 'i');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/signup', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); if (d.success) { authToken = d.token; localStorage.setItem('p24_token', authToken); goToDashboard(); showToast('Welcome! 🎉', 's'); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); }
    };
    xhr.onerror = function() { showToast('Network error', 'e'); };
    xhr.send(JSON.stringify({ username: u, whatsapp: w, password: p, referralCode: r }));
}

function handleLogin() {
    var u = $('loginUser').value.trim(), p = $('loginPass').value.trim();
    if (!u || !p) return showToast('All fields required', 'e');
    showToast('Signing in...', 'i');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/login', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); if (d.success) { authToken = d.token; localStorage.setItem('p24_token', authToken); goToDashboard(); showToast('Welcome! 👋', 's'); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); }
    };
    xhr.onerror = function() { showToast('Network error', 'e'); };
    xhr.send(JSON.stringify({ username: u, password: p }));
}

function handleLogout() { localStorage.removeItem('p24_token'); authToken = null; hideAllPages(); $('authSection').classList.remove('hidden'); showLoginForm(); showToast('Logged out', 'i'); }

// Dashboard
function loadDashboardData() {
    if (!authToken) { hideAllPages(); $('authSection').classList.remove('hidden'); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/dashboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                $('dashUser').textContent = '👋 Welcome, ' + d.username;
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
                $('refLink').textContent = window.location.origin + '?ref=' + d.referralCode;
            }
        } catch(e) { }
    };
    xhr.send();
}

// Deposit Flow
function openDeposit() { hideAllPages(); $('plansSection').classList.remove('hidden'); loadPlansList(); }

function loadPlansList() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/plans', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success && d.plans) {
                var html = '';
                for (var i = 0; i < d.plans.length; i++) {
                    var p = d.plans[i], tr = p.amount * (p.dailyProfit / 100) * p.duration;
                    html += '<div class="glass plan-card" onclick="choosePlan(' + p.planId + ',' + p.amount + ',\'' + p.name + '\')"><div class="plan-name">' + p.name + '</div><div class="plan-amount">PKR ' + fmt(p.amount) + '</div><div class="plan-info">📈 ' + p.dailyProfit + '% Daily | 📅 ' + p.duration + ' Days</div><div class="plan-info">💎 Total: PKR ' + fmt(tr) + '</div></div>';
                }
                $('plansGrid').innerHTML = html;
            }
        } catch(e) { }
    };
    xhr.send();
}

function choosePlan(id, amt, name) {
    selectedPlan = { id: id, amt: amt, name: name };
    var cards = document.querySelectorAll('.plan-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('selected');
    if (event && event.target) { var c = event.target.closest('.plan-card'); if (c) c.classList.add('selected'); }
    setTimeout(function() { hideAllPages(); $('paymentSection').classList.remove('hidden'); showPaymentPage(); }, 300);
}

function showPaymentPage() {
    if (!selectedPlan) return goToPlans();
    $('payPlanName').textContent = selectedPlan.name;
    $('payPlanAmt').textContent = fmt(selectedPlan.amt);
}

function selectPaymentMethod(method) { selectedPayment = method; hideAllPages(); $('depositSection').classList.remove('hidden'); $('depMethod').textContent = method.toUpperCase(); loadAccountInfo(method); }

function loadAccountInfo(method) {
    if (accountData) { showAccountInfo(method); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/deposit-accounts', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { accountData = d; showAccountInfo(method); } } catch(e) { } };
    xhr.send();
}

function showAccountInfo(method) {
    var a = accountData[method];
    $('accInfo').innerHTML = '<div class="glass" style="padding:18px;"><p>📱 <strong>' + method.toUpperCase() + '</strong></p><p>🔢 Number: <strong>' + a.number + '</strong> <button class="btn-sm" onclick="copyText(\'' + a.number + '\')">📋 Copy</button></p><p>📛 Title: <strong>' + a.title + '</strong></p></div>';
}

function copyText(t) { navigator.clipboard.writeText(t); showToast('Copied! 📋', 's'); }
function copyReferralLink() { navigator.clipboard.writeText($('refLink').textContent); showToast('Link copied! 📋', 's'); }

function submitDepositNow() {
    if (!selectedPlan || !selectedPayment) return showToast('Select plan & method', 'e');
    var tx = $('depTx').value.trim(), fi = $('depSS').files[0];
    if (!tx || !fi) return showToast('TxID + Screenshot', 'e');
    var fd = new FormData();
    fd.append('planId', selectedPlan.id); fd.append('accountType', selectedPayment); fd.append('txId', tx); fd.append('screenshot', fi);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/deposit', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { showToast('Deposit submitted! ✅', 's'); goToDashboard(); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); } };
    xhr.send(fd);
}

// Withdraw
function openWithdraw() { hideAllPages(); $('withdrawSection').classList.remove('hidden'); loadDashboardData(); }

function submitWithdrawNow() {
    var t = $('wdType').value, n = $('wdNum').value.trim(), ti = $('wdTitle').value.trim(), a = parseFloat($('wdAmt').value);
    if (!t || !n || !ti || !a) return showToast('All fields required', 'e');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/withdraw', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { showToast('Withdrawal submitted! ✅', 's'); goToDashboard(); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); } };
    xhr.send(JSON.stringify({ accountType: t, accountNumber: n, accountTitle: ti, amount: a }));
}

// Fund Transfer
function openTransfer() { hideAllPages(); $('transferSection').classList.remove('hidden'); $('tfConfirm').classList.add('hidden'); loadDashboardData(); }

function verifyReceiverPID() {
    var pid = $('tfPID').value.trim(), amt = parseFloat($('tfAmt').value);
    if (!pid || !amt) return showToast('PID + Amount required', 'e');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/verify-pid', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) { $('tfConfirm').classList.remove('hidden'); $('tfConfirm').innerHTML = '<div class="glass" style="padding:20px;margin-top:15px;"><h3>✅ Receiver Found</h3><p>👤 <strong>' + d.user.username + '</strong></p><p>📱 ' + d.user.whatsapp + '</p><p>🆔 PID: ' + d.user.pid + '</p><p style="color:#fbbf24;font-size:20px;font-weight:900;">Amount: PKR ' + fmt(amt) + '</p><button class="btn" onclick="confirmTransferNow(\'' + pid + '\',' + amt + ')">✅ Confirm Transfer</button></div>'; }
            else showToast(d.error, 'e');
        } catch(e) { showToast('Error', 'e'); }
    };
    xhr.send(JSON.stringify({ pid: pid }));
}

function confirmTransferNow(pid, amt) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/fund-transfer', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { showToast('✅ Transfer successful!', 's'); goToDashboard(); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); } };
    xhr.send(JSON.stringify({ receiverPid: pid, amount: amt }));
}

// My Plan
function checkMyPlan() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/dashboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); if (d.success && d.activePlan && d.activePlan.planId) { var p = d.activePlan; showToast('📋 ' + p.name + '\n💰 Daily: PKR ' + p.dailyProfit.toFixed(2) + '\n📅 Day: ' + p.profitDays + '/60', 'i'); } else showToast('No active plan', 'e'); } catch(e) { }
    };
    xhr.send();
}

// History
function openHistory(type) { hideAllPages(); $('historySection').classList.remove('hidden'); loadHistoryData(type); }

function loadHistoryData(type) {
    var title = type === 'deposits' ? '📥 Deposit History' : type === 'withdrawals' ? '📤 Withdrawal History' : '📊 Transaction History';
    var url = type === 'deposits' ? '/api/deposits' : type === 'withdrawals' ? '/api/withdrawals' : '/api/transactions';
    $('historyTitle').textContent = title;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + url, true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); var items = d.deposits || d.withdrawals || d.transactions || []; $('historyContent').innerHTML = renderHistoryCards(items); } catch(e) { } };
    xhr.send();
}

function renderHistoryCards(items) {
    if (!items || !items.length) return '<p style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No records found</p>';
    var h = '';
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var sc = 'status-' + (it.status === 'completed' ? 'completed' : it.status);
        var si = it.status === 'approved' || it.status === 'completed' ? '✅' : it.status === 'rejected' ? '❌' : '⏳';
        var rd = new Date(it.createdAt), pd = it.processedAt ? new Date(it.processedAt) : null;
        var rt = rd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + rd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        var pt = pd ? pd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + pd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '---';
        var tl = it.type === 'deposit' ? '📥 DEPOSIT' : it.type === 'withdraw' ? '📤 WITHDRAWAL' : it.type === 'profit' ? '💎 PROFIT' : it.type === 'referral' ? '🎁 REFERRAL' : it.type === 'transfer_sent' ? '🔄 SENT' : it.type === 'transfer_received' ? '🔄 RECEIVED' : it.type === 'refund' ? '↩️ REFUND' : it.type.toUpperCase();
        h += '<div class="hist-card"><div class="hist-header"><span class="hist-type">' + tl + '</span><span class="hist-status ' + sc + '">' + si + ' ' + it.status.toUpperCase() + '</span></div><div class="hist-body"><div class="hist-item"><span class="hist-label">Amount</span><span class="hist-value amount">PKR ' + fmt(it.amount) + '</span></div>';
        if (it.fee > 0) h += '<div class="hist-item"><span class="hist-label">Fee</span><span class="hist-value" style="color:#f87171;">PKR ' + fmt(it.fee) + '</span></div>';
        if (it.accountType) h += '<div class="hist-item"><span class="hist-label">Method</span><span class="hist-value">' + it.accountType.toUpperCase() + '</span></div>';
        if (it.txId) h += '<div class="hist-item"><span class="hist-label">TxID</span><span class="hist-value" style="font-size:11px;">' + it.txId + '</span></div>';
        if (it.planName) h += '<div class="hist-item"><span class="hist-label">Plan</span><span class="hist-value">' + it.planName + '</span></div>';
        if (it.relatedUsername) h += '<div class="hist-item"><span class="hist-label">' + (it.type === 'transfer_sent' ? 'To' : 'From') + '</span><span class="hist-value">' + it.relatedUsername + '</span></div>';
        h += '</div><div class="hist-timeline"><span>📅 ' + rt + '</span><span>' + (it.status === 'pending' ? '⏳' : '✅') + ' ' + pt + '</span></div></div>';
    }
    return h;
}

// Team
function openTeam() { hideAllPages(); $('historySection').classList.remove('hidden'); loadTeamData(); }

function loadTeamData() {
    $('historyTitle').textContent = '👥 My Team';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/team', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); var h = '<p style="margin-bottom:20px;">Total: <strong>' + (d.teamCount || 0) + '</strong> members</p>'; if (d.team) for (var i = 0; i < d.team.length; i++) { var m = d.team[i]; h += '<div class="hist-card"><div class="hist-header"><span>👤 ' + m.username + '</span></div><div class="hist-body"><div class="hist-item"><span class="hist-label">Invested</span><span class="hist-value amount">PKR ' + fmt(m.totalInvested) + '</span></div><div class="hist-item"><span class="hist-label">Joined</span><span class="hist-value">' + new Date(m.createdAt).toLocaleDateString() + '</span></div></div></div>'; } $('historyContent').innerHTML = h; } catch(e) { }
    };
    xhr.send();
}

// Profile
function openProfile() {
    hideAllPages(); $('profileSection').classList.remove('hidden');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/profile', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { $('pfPID').textContent = d.user.pid; $('pfWA').value = d.user.whatsapp || ''; } } catch(e) { } };
    xhr.send();
}

function saveProfile() {
    var fd = new FormData(), wa = $('pfWA').value.trim(), pass = $('pfPass').value.trim();
    if (wa) fd.append('whatsapp', wa);
    if (pass) fd.append('password', pass);
    if (!wa && !pass) return showToast('No changes', 'e');
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', API_URL + '/api/profile', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); if (d.success) { showToast('Profile updated! ✅', 's'); goToDashboard(); } else showToast(d.error, 'e'); } catch(e) { showToast('Error', 'e'); } };
    xhr.send(fd);
}

// Leaderboard
function openLeaderboard() { hideAllPages(); $('leaderboardSection').classList.remove('hidden'); loadLeaderboardData(); }

function loadLeaderboardData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/leaderboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); var h1 = '', h2 = ''; if (d.topInvestors) for (var i = 0; i < d.topInvestors.length; i++) h1 += '<p>' + (i + 1) + '. 🏅 ' + d.topInvestors[i].username + ' - PKR ' + fmt(d.topInvestors[i].totalInvested) + '</p>'; if (d.topReferrers) for (var j = 0; j < d.topReferrers.length; j++) h2 += '<p>' + (j + 1) + '. 🔗 ' + d.topReferrers[j].username + ' - ' + (d.topReferrers[j].count || 0) + ' refs</p>'; $('topInv').innerHTML = h1 || '<p>No data</p>'; $('topRef').innerHTML = h2 || '<p>No data</p>'; } catch(e) { }
    };
    xhr.send();
}

// FAQ
function openFAQ() { hideAllPages(); $('faqSection').classList.remove('hidden'); loadFAQData(); }

function loadFAQData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/faqs', true);
    xhr.onload = function() {
        try { var d = JSON.parse(xhr.responseText); if (d.faqs && d.faqs.length) { var h = ''; for (var i = 0; i < d.faqs.length; i++) h += '<div class="glass form-card" style="margin:14px 0;"><h3 style="color:#a78bfa;">❓ ' + d.faqs[i].question + '</h3><p style="color:rgba(255,255,255,0.7);">' + d.faqs[i].answer + '</p></div>'; $('faqContent').innerHTML = h; } else $('faqContent').innerHTML = '<p style="text-align:center;padding:30px;">No FAQs</p>'; } catch(e) { }
    };
    xhr.send();
}

// Support
function openSupport() { $('supportModal').classList.remove('hidden'); }
function closeSupportModal() { $('supportModal').classList.add('hidden'); }

// Chat
function openChatWidget() { closeSupportModal(); $('chatWidget').classList.remove('hidden'); }
function closeChatWidget() { $('chatWidget').classList.add('hidden'); }

function sendChatMessage() {
    var input = $('chatInput'), msg = input.value.trim();
    if (!msg) return;
    var body = $('chatBody');
    body.innerHTML += '<div class="chat-msg user">' + msg + '</div>';
    input.value = ''; body.scrollTop = body.scrollHeight;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() { try { var d = JSON.parse(xhr.responseText); body.innerHTML += '<div class="chat-msg bot">' + d.reply + '</div>'; body.scrollTop = body.scrollHeight; } catch(e) { } };
    xhr.send(JSON.stringify({ message: msg }));
}

// Init
(function() {
    hideAllPages();
    if (authToken) { $('dashSection').classList.remove('hidden'); loadDashboardData(); }
    else { $('authSection').classList.remove('hidden'); showLoginForm(); }
})();
