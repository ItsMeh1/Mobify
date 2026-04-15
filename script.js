import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  arrayUnion,
  arrayRemove,
  increment
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBprG8pYZ1WQNh2wt0kih3P7Z3nIxhnU5k",
  authDomain: "mobify-5b3c9.firebaseapp.com",
  projectId: "mobify-5b3c9",
  storageBucket: "mobify-5b3c9.firebasestorage.app",
  messagingSenderId: "454093361079",
  appId: "1:454093361079:web:ab1e1093a91a705be3a232"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


let userProfile = null;
let isPosting = false;
let postImgBase64 = "";
let signupPfpBase64 = "";
let editPfpBase64 = "";
let isLoginMode = true;
let adminUsersCache = [];
let adminPostsCache = [];
let feedUnsubscribe = null;
let selectedProfileUid = null;
let selectedPostId = null;

const showToast = (m) => {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerText = m;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
};

const escapeHTML = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeHandle = (n) => `@${(n || 'user').toLowerCase().replace(/\s/g, '')}`;
const fallbackPfp = (name = 'User', seed = 'user') => {
  const safeSeed = encodeURIComponent((name || seed || 'user').toString());
  return `https://ui-avatars.com/api/?name=${safeSeed}&background=1d9bf0&color=fff&bold=true`;
};
const getPfpSrc = (pfp, name = 'User', seed = 'user') => {
  if (!pfp || !String(pfp).trim()) return fallbackPfp(name, seed);
  return pfp;
};
const timeAgo = (timestamp) => {
  if (!timestamp) return '';
  const ms = Date.now() - Number(timestamp);
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};
const getPriority = (u) => Number(u?.rankPriority ?? 0);
const isOwner = (u) => (u?.role === 'Owner') || getPriority(u) >= 1000;
const isStaff = (u) => isOwner(u) || getPriority(u) >= 500;
const canActOn = (target) => {
  if (!userProfile || !target) return false;
  if (isOwner(target)) return isOwner(userProfile);
  return isStaff(userProfile) && getPriority(userProfile) > getPriority(target);
};
const canModerate = (target) => {
  if (!userProfile || !target) return false;
  if (isOwner(target)) return isOwner(userProfile);
  return isStaff(userProfile) && getPriority(userProfile) > getPriority(target);
};
const postAnalytics = (p) => ({
  likes: p.likes?.length || 0,
  comments: p.comments?.length || 0,
  views: p.views || 0
});
const getRankLabel = (u) => u?.role || 'Member';
const badgeHTML = (u) => {
  if (!u) return '';
  const parts = [];
  if (isOwner(u)) parts.push('<span class="badge badge-owner">Owner</span>');
  else if (getPriority(u) >= 500) parts.push('<span class="badge badge-admin">Staff</span>');
  else if (u.role && u.role !== 'Member') parts.push(`<span class="badge badge-rank">${escapeHTML(u.role)}</span>`);
  if (u.verified) parts.push('<span class="badge badge-verified">Verified</span>');
  if (u.muted) parts.push('<span class="badge badge-muted">Muted</span>');
  if (u.banned) parts.push('<span class="badge badge-banned">Banned</span>');
  return parts.join(' ');
};
const normalizeUser = (uid, data = {}) => ({
  uid,
  name: data.name || 'User',
  email: data.email || '',
  pfp: getPfpSrc(data.pfp, data.name || 'User', uid),
  role: data.role || 'Member',
  rankPriority: Number(data.rankPriority ?? (data.role === 'Owner' ? 1000 : data.role === 'Admin' ? 500 : 0)),
  muted: !!data.muted,
  banned: !!data.banned,
  banReason: data.banReason || '',
  verified: !!data.verified,
  verifiedRequested: !!data.verifiedRequested,
  bio: data.bio || 'Mobify Elite User',
  status: data.status || 'Online'
});
const myName = () => userProfile?.name || 'User';
const myPfp = () => getPfpSrc(userProfile?.pfp, myName(), auth.currentUser?.uid || 'user');
const currentUid = () => auth.currentUser?.uid || '';
const safeText = (s) => escapeHTML(s || '');

window.showToast = showToast;
window.closeModals = () => document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
window.clearPostImage = () => { postImgBase64 = ''; document.getElementById('postImgPreviewArea').classList.add('hidden'); };

function requireNotBanned() {
  if (userProfile?.banned) {
    showToast('You are banned. You can view, but actions are blocked.');
    return false;
  }
  return true;
}

function setSidebarProfile() {
  document.getElementById('mySideName').innerText = userProfile?.name || 'User';
  document.getElementById('mySideHandle').innerText = safeHandle(userProfile?.name || 'User');
  document.getElementById('mySidePfp').src = myPfp();
  document.getElementById('mySidePfp').onerror = () => { document.getElementById('mySidePfp').src = fallbackPfp(myName(), currentUid()); };
}

function updateTopAdminVisibility() {
  if (isStaff(userProfile)) document.getElementById('adminBtn').classList.remove('hidden');
  else document.getElementById('adminBtn').classList.add('hidden');
}

function setPostLikeState(button, liked) {
  button.classList.toggle('liked', liked);
}

// AUTH
const authBtn = document.getElementById('toggleAuth');
authBtn.onclick = () => {
  isLoginMode = !isLoginMode;
  document.getElementById('authTitle').innerText = isLoginMode ? 'Mobify' : 'Join Mobify';
  document.getElementById('authName').classList.toggle('hidden', isLoginMode);
  document.getElementById('signupPfpArea').classList.toggle('hidden', isLoginMode);
  document.getElementById('authBtn').innerText = isLoginMode ? 'Sign In' : 'Create Account';
};

document.getElementById('signupPfpInput').onchange = (e) => {
  const f = e.target.files[0];
  if (f) {
    const r = new FileReader();
    r.onload = (ev) => { signupPfpBase64 = ev.target.result; document.getElementById('signupPfpPreview').src = signupPfpBase64; };
    r.readAsDataURL(f);
  }
};

document.getElementById('authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const name = document.getElementById('authName').value.trim() || 'User';
      const res = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, 'users', res.user.uid), {
        name,
        email,
        pfp: signupPfpBase64 || fallbackPfp(name, res.user.uid),
        role: 'Member',
        rankPriority: 0,
        muted: false,
        banned: false,
        banReason: '',
        verified: false,
        verifiedRequested: false,
        bio: 'Mobify Elite User',
        status: 'Online',
        createdAt: Date.now()
      });
    }
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('logoutBtn').onclick = () => signOut(auth);
document.getElementById('homeBtn').onclick = () => document.getElementById('feed').scrollIntoView({ behavior: 'smooth', block: 'start' });
document.getElementById('trendBtn').onclick = () => document.getElementById('trendsList').parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

document.getElementById('profileEditBtn').onclick = () => openEditProfile();
document.getElementById('verifyRequestBtn').onclick = async () => {
  if (!selectedProfileUid || selectedProfileUid !== currentUid()) return;
  if (userProfile?.verified) return showToast('Already verified.');
  if (userProfile?.verifiedRequested) return showToast('Verification already requested.');
  await updateDoc(doc(db, 'users', currentUid()), { verifiedRequested: true });
  userProfile.verifiedRequested = true;
  showToast('Verification requested.');
  openProfile(selectedProfileUid);
};

document.getElementById('editPfpInput').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => { editPfpBase64 = ev.target.result; };
  r.readAsDataURL(f);
};

window.openEditProfile = () => {
  if (!userProfile) return;
  document.getElementById('editName').value = userProfile.name || '';
  document.getElementById('editBio').value = userProfile.bio || '';
  document.getElementById('editStatus').value = userProfile.status || '';
  editPfpBase64 = '';
  document.getElementById('editPfpInput').value = '';
  document.getElementById('editProfileModal').style.display = 'flex';
};

document.getElementById('saveProfileBtn').onclick = async () => {
  if (!auth.currentUser) return;
  const name = document.getElementById('editName').value.trim() || 'User';
  const bio = document.getElementById('editBio').value.trim() || 'Mobify Elite User';
  const status = document.getElementById('editStatus').value.trim() || 'Online';
  await updateDoc(doc(db, 'users', currentUid()), {
    name,
    bio,
    status,
    ...(editPfpBase64 ? { pfp: editPfpBase64 } : {})
  });
  showToast('Profile updated');
  closeModals();
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const raw = snap.exists() ? snap.data() : {};
    userProfile = normalizeUser(user.uid, raw);

    if (!snap.exists()) {
      await setDoc(ref, {
        name: user.displayName || 'User',
        email: user.email || '',
        pfp: fallbackPfp(user.displayName || 'User', user.uid),
        role: 'Member',
        rankPriority: 0,
        muted: false,
        banned: false,
        banReason: '',
        verified: false,
        verifiedRequested: false,
        bio: 'Mobify Elite User',
        status: 'Online',
        createdAt: Date.now()
      });
      userProfile = normalizeUser(user.uid, {
        name: user.displayName || 'User',
        email: user.email || '',
        pfp: fallbackPfp(user.displayName || 'User', user.uid)
      });
    }

    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').style.display = 'grid';
    document.getElementById('fab').style.display = 'flex';
    setSidebarProfile();
    updateTopAdminVisibility();
    initApp();
  } else {
    userProfile = null;
    selectedProfileUid = null;
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('fab').style.display = 'none';
    if (feedUnsubscribe) { feedUnsubscribe(); feedUnsubscribe = null; }
  }
});

// FEED
function renderTrends(posts) {
  const trends = {};
  posts.forEach(data => {
    const matches = data.text?.match(/#\w+/g);
    if (matches) matches.forEach(t => trends[t] = (trends[t] || 0) + 1);
  });
  const tList = document.getElementById('trendsList');
  tList.innerHTML = '';
  Object.entries(trends).sort((a,b) => b[1] - a[1]).slice(0, 5).forEach(([name, count]) => {
    const div = document.createElement('div');
    div.className = 'trend-item';
    div.innerHTML = `<span class="trend-name">${safeText(name)}</span><span class="trend-count">${count} posts</span>`;
    tList.appendChild(div);
  });
  if (!Object.keys(trends).length) tList.innerHTML = '<div class="tiny">No trending tags yet.</div>';
}

function initApp() {
  const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
  if (feedUnsubscribe) feedUnsubscribe();
  feedUnsubscribe = onSnapshot(q, (snapshot) => {
    const feed = document.getElementById('feed');
    const posts = [];
    snapshot.forEach(d => posts.push({ id: d.id, ...d.data() }));

    renderTrends(posts);
    adminPostsCache = posts;
    updateAdminStats();

    feed.innerHTML = '';
    posts.sort((a,b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).forEach(p => feed.appendChild(renderPost(p)));
  });
}

function renderPost(p) {
  const div = document.createElement('div');
  div.className = `post ${p.pinned ? 'pinned' : ''}`;
  const uid = currentUid();
  const isLiked = p.likes?.includes(uid);
  const author = normalizeUser(p.authorId, {
    name: p.authorName,
    pfp: p.authorPfp,
    role: p.authorRole,
    rankPriority: p.authorPriority,
    verified: p.authorVerified,
    muted: p.authorMuted,
    banned: p.authorBanned
  });

  div.innerHTML = `
    ${p.pinned ? `<span class="pinned-label">📌 Pinned</span>` : ''}
    <img class="avatar" src="${author.pfp}" alt="${safeText(author.name)}" onerror="this.src='${fallbackPfp(author.name, author.uid)}'" onclick="window.viewUserProfile('${p.authorId}'); event.stopPropagation();">
    <div class="post-content" onclick="window.showDetail('${p.id}')">
      <div class="post-header">
        <span class="post-name">${safeText(author.name)}</span>
        ${badgeHTML(author)}
        <span class="post-handle">${safeHandle(author.name)}</span>
      </div>
      <div class="post-body">${safeText(p.text || '')}</div>
      ${p.image ? `<img src="${p.image}" class="post-media" alt="post media">` : ''}
      <div class="post-actions">
        <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="window.interact('${p.id}', 'likes'); event.stopPropagation();">👍 ${p.likes?.length || 0}</button>
        <button class="action-btn" onclick="window.showDetail('${p.id}'); event.stopPropagation();">💬 ${p.comments?.length || 0}</button>
        ${(isStaff(userProfile) || isOwner(userProfile)) ? `
          <button class="action-btn" style="color:var(--accent)" onclick="window.togglePin('${p.id}', ${!!p.pinned}); event.stopPropagation();">📌 ${p.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="action-btn" style="color:var(--danger)" onclick="window.deletePost('${p.id}'); event.stopPropagation();">🗑️</button>
        ` : ''}
      </div>
    </div>
  `;
  return div;
}

window.interact = async (pid, type) => {
  if (!requireNotBanned()) return;
  const ref = doc(db, 'posts', pid);
  const snap = await getDoc(ref);
  const uid = currentUid();
  const current = snap.data()?.[type] || [];
  if (current.includes(uid)) await updateDoc(ref, { [type]: arrayRemove(uid) });
  else await updateDoc(ref, { [type]: arrayUnion(uid) });
};

window.togglePin = async (pid, current) => {
  if (!isStaff(userProfile)) return showToast('No permission.');
  await updateDoc(doc(db, 'posts', pid), { pinned: !current });
  showToast(current ? 'Unpinned' : 'Pinned to top!');
};

window.deletePost = async (pid) => {
  if (!isStaff(userProfile)) return showToast('No permission.');
  if (!confirm('Delete this post from Firestore?')) return;
  await deleteDoc(doc(db, 'posts', pid));
  showToast('Post deleted from Firestore.');
};

function renderCommentCard(c) {
  const commentPfp = getPfpSrc(c.pfp, c.name, c.uid);
  return `
    <div class="comment-shell">
      <img class="comment-avatar" src="${commentPfp}" alt="${safeText(c.name || 'User')}" onerror="this.src='${fallbackPfp(c.name || 'User', c.uid || 'comment')}'">
      <div class="comment-card">
        <div class="comment-top">
          <span class="comment-name">${safeText(c.name || 'User')}</span>
          <span class="comment-time">${timeAgo(c.time)}</span>
        </div>
        <div class="comment-text">${safeText(c.text || '')}</div>
      </div>
    </div>
  `;
}

window.showDetail = async (pid) => {
  const snap = await getDoc(doc(db, 'posts', pid));
  const p = snap.data();
  if (!p) return;
  selectedPostId = pid;

  await updateDoc(doc(db, 'posts', pid), { views: increment(1) });

  const author = normalizeUser(p.authorId, {
    name: p.authorName,
    pfp: p.authorPfp,
    role: p.authorRole,
    rankPriority: p.authorPriority,
    verified: p.authorVerified,
    muted: p.authorMuted,
    banned: p.authorBanned
  });
  const box = document.getElementById('detailContent');
  const comments = (p.comments || []).slice().sort((a,b) => (a.time || 0) - (b.time || 0));
  const an = postAnalytics(p);

  box.innerHTML = `
    <div style="display:flex; gap:12px; align-items:center; margin-bottom:20px;">
      <img src="${author.pfp}" style="width:50px; height:50px; border-radius:50%; object-fit:cover; border:1px solid var(--border-bright)" onerror="this.src='${fallbackPfp(author.name, author.uid)}'">
      <div>
        <div style="font-weight:800; font-size:18px;">${safeText(author.name)}</div>
        <div style="color:var(--muted)">${safeHandle(author.name)}</div>
      </div>
    </div>
    <div style="font-size:20px; line-height:1.5; margin-bottom:20px; white-space:pre-wrap; word-break:break-word;">${safeText(p.text || '')}</div>
    ${p.image ? `<img src="${p.image}" style="width:100%; border-radius:16px; margin-bottom:20px; border:1px solid var(--border);" alt="post image">` : ''}
    <div class="glass" style="padding:14px; border-radius:16px; margin-bottom:18px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
      <div><div class="tiny">Views</div><div style="font-size:18px; font-weight:900;">${an.views}</div></div>
      <div><div class="tiny">Likes</div><div style="font-size:18px; font-weight:900;">${an.likes}</div></div>
      <div><div class="tiny">Comments</div><div style="font-size:18px; font-weight:900;">${an.comments}</div></div>
    </div>
    <hr class="divider">
    <h4 class="section-title">Comments (${comments.length})</h4>
    <div id="detailComments">${comments.length ? comments.map(renderCommentCard).join('') : '<div class="tiny">No comments yet. Be the first.</div>'}</div>
    <div style="display:flex; gap:10px; margin-top:20px; align-items:flex-start;">
      <input id="detInp" class="input-field" style="margin:0; flex:1;" placeholder="Add a comment...">
      <button onclick="window.postDetComment('${pid}')" class="btn-primary" style="width:auto; padding:0 20px; height:48px;">Send</button>
    </div>
  `;
  document.getElementById('detailModal').style.display = 'flex';
};

window.postDetComment = async (pid) => {
  if (!requireNotBanned()) return;
  const val = document.getElementById('detInp').value.trim();
  if (!val) return;
  if (!userProfile) return showToast('Profile is still loading.');

  await updateDoc(doc(db, 'posts', pid), {
    comments: arrayUnion({
      uid: currentUid(),
      name: userProfile.name,
      pfp: userProfile.pfp || fallbackPfp(userProfile.name, currentUid()),
      text: val,
      time: Date.now()
    })
  });
  document.getElementById('detInp').value = '';
  window.showDetail(pid);
};

async function openProfile(uid) {
  selectedProfileUid = uid;
  const snap = await getDoc(doc(db, 'users', uid));
  const d = normalizeUser(uid, snap.data() || {});
  document.getElementById('profPfp').src = d.pfp;
  document.getElementById('profPfp').onerror = () => { document.getElementById('profPfp').src = fallbackPfp(d.name, uid); };
  document.getElementById('profName').innerText = d.name;
  document.getElementById('profBio').innerText = d.bio;
  document.getElementById('profStatus').innerText = d.status ? `Status: ${d.status}` : '';
  document.getElementById('profBadgeSlot').innerHTML = badgeHTML(d) + (d.role && d.role !== 'Member' && !isOwner(d) && getPriority(d) < 500 ? `<span class="badge badge-rank">${safeText(d.role)}</span>` : '');

  const notice = document.getElementById('profNotice');
  if (d.banned) {
    notice.classList.remove('hidden');
    notice.innerHTML = `<strong style="color:#fff">Banned</strong><br>${safeText(d.banReason || 'No reason provided.')}`;
  } else {
    notice.classList.add('hidden');
    notice.innerHTML = '';
  }

  const editBtn = document.getElementById('profileEditBtn');
  const verifyBtn = document.getElementById('verifyRequestBtn');
  const isSelf = uid === currentUid();
  editBtn.classList.toggle('hidden', !isSelf);
  verifyBtn.classList.toggle('hidden', !isSelf);
  verifyBtn.disabled = !!d.verified || !!d.verifiedRequested;
  verifyBtn.innerText = d.verified ? 'Verified' : d.verifiedRequested ? 'Verification Requested' : 'Request Verification';
  document.getElementById('profileModal').style.display = 'flex';
}

window.viewUserProfile = openProfile;

// POSTING
document.getElementById('fab').onclick = () => {
  if (!requireNotBanned()) return;
  document.getElementById('postModal').style.display = 'flex';
};

document.getElementById('postFileInput').onchange = (e) => {
  const f = e.target.files[0];
  if (f) {
    const r = new FileReader();
    r.onload = (ev) => {
      postImgBase64 = ev.target.result;
      document.getElementById('postPreviewImg').src = postImgBase64;
      document.getElementById('postImgPreviewArea').classList.remove('hidden');
    };
    r.readAsDataURL(f);
  }
};

document.getElementById('submitPostBtn').onclick = async () => {
  if (isPosting) return; // 🚫 block spam clicks
  if (!requireNotBanned()) return;

  const btn = document.getElementById('submitPostBtn');
  const text = document.getElementById('postText').value.trim();

  if (!text && !postImgBase64) return;
  if (!userProfile) return showToast('Syncing profile... wait a second.');
  if (userProfile.muted) return showToast('You are muted.');
  if (userProfile.banned) return showToast('You are banned.');

  try {
    isPosting = true;
    btn.disabled = true;
    btn.innerText = "Posting...";

    await addDoc(collection(db, 'posts'), {
      authorId: currentUid(),
      authorName: userProfile.name || 'User',
      authorPfp: myPfp(),
      authorRole: userProfile.role || 'Member',
      authorPriority: getPriority(userProfile),
      authorMuted: !!userProfile.muted,
      authorVerified: !!userProfile.verified,
      authorBanned: !!userProfile.banned,
      text,
      image: postImgBase64,
      timestamp: Date.now(),
      views: 0,
      likes: [],
      comments: [],
      pinned: false
    });

    document.getElementById('postText').value = '';
    clearPostImage();
    closeModals();

  } catch (err) {
    showToast(err.message);
  } finally {
    isPosting = false;
    btn.disabled = false;
    btn.innerText = "Post";
  }
};

// ADMIN
const adminFilterEl = document.getElementById('adminFilter');
const adminSearchEl = document.getElementById('adminSearch');

function updateAdminStats() {
  const users = adminUsersCache || [];
  const posts = adminPostsCache || [];
  document.getElementById('statUsers').innerText = users.length;
  document.getElementById('statVerified').innerText = users.filter(u => u.verified).length;
  document.getElementById('statBanned').innerText = users.filter(u => u.banned).length;
  document.getElementById('statPosts').innerText = posts.length;
  document.getElementById('statViews').innerText = posts.reduce((sum, p) => sum + (p.views || 0), 0);
  document.getElementById('adminSummary').innerText = `${users.length} users • ${posts.length} posts • ${users.filter(u => u.verifiedRequested).length} verification requests`;
}

function visibleUsersFilter(users) {
  const search = (adminSearchEl.value || '').trim().toLowerCase();
  const filter = adminFilterEl.value;
  return users.filter(u => {
    const hay = `${u.name} ${u.email} ${u.role} ${u.uid} ${u.status}`.toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter === 'muted') return u.muted;
    if (filter === 'banned') return u.banned;
    if (filter === 'verified') return u.verified;
    if (filter === 'requested') return u.verifiedRequested;
    if (filter === 'staff') return isStaff(u);
    if (filter === 'owners') return isOwner(u);
    return true;
  });
}

function renderAdminUsers(users) {
  const list = document.getElementById('adminUserList');
  list.innerHTML = '';
  if (!users.length) {
    list.innerHTML = '<div class="tiny">No users match this filter.</div>';
    return;
  }

  users.forEach(u => {
    const canChange = canModerate(u);
    const div = document.createElement('div');
    div.className = 'admin-card';
    div.innerHTML = `
      <div class="admin-row">
        <img src="${u.pfp}" style="width:38px; height:38px; border-radius:50%; object-fit:cover; border:1px solid var(--border-bright)" onerror="this.src='${fallbackPfp(u.name, u.uid)}'">
        <div class="admin-meta">
          <div class="admin-name">${safeText(u.name)}</div>
          <div class="admin-email">${safeText(u.email || 'No email')}</div>
          <div class="tiny">@${safeText(u.uid.slice(0,8))} • ${safeText(u.status || 'No status')}</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end; max-width: 58%;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          <span class="admin-chip">${safeText(u.role || 'Member')} • ${getPriority(u)}</span>
          ${u.verified ? '<span class="admin-chip" style="color:var(--success)">Verified</span>' : ''}
          ${u.verifiedRequested ? '<span class="admin-chip" style="color:var(--accent)">Verify Req</span>' : ''}
          ${u.banned ? '<span class="admin-chip" style="color:var(--danger)">Banned</span>' : ''}
          ${u.muted ? '<span class="admin-chip" style="color:var(--warning)">Muted</span>' : ''}
        </div>
        <div class="admin-tools">
          <button class="tool-btn accent" onclick="window.viewUserProfile('${u.uid}')">Profile</button>
          <button class="tool-btn" onclick="window.setCustomRank('${u.uid}')" ${!canChange ? 'disabled' : ''}>Rank</button>
          <button class="tool-btn ${u.verified ? 'danger' : 'success'}" onclick="window.toggleVerified('${u.uid}', ${u.verified})" ${!canChange ? 'disabled' : ''}>${u.verified ? 'Unverify' : 'Verify'}</button>
          <button class="tool-btn ${u.banned ? 'success' : 'danger'}" onclick="window.toggleBan('${u.uid}', ${u.banned}, ${JSON.stringify(u.name)})" ${!canChange ? 'disabled' : ''}>${u.banned ? 'Unban' : 'Ban'}</button>
          <button class="tool-btn ${u.muted ? 'success' : 'danger'}" onclick="window.toggleUserMute('${u.uid}', ${u.muted})" ${!canChange ? 'disabled' : ''}>${u.muted ? 'Unmute' : 'Mute'}</button>
        </div>
      </div>
    `;
    list.appendChild(div);
  });
}

async function refreshAdminPanel() {
  const userSnap = await getDocs(collection(db, 'users'));
  const users = [];
  userSnap.forEach(docS => users.push(normalizeUser(docS.id, docS.data())));
  adminUsersCache = users;
  renderAdminUsers(visibleUsersFilter(users));
  updateAdminStats();
}

window.setCustomRank = async (uid) => {
  const targetSnap = await getDoc(doc(db, 'users', uid));
  const target = normalizeUser(uid, targetSnap.data() || {});
  if (!canModerate(target)) return showToast('You cannot change this user.');
  if (isOwner(target)) return showToast('Owner rank is locked.');

  const label = prompt('Rank label', target.role || 'Member');
  if (label === null) return;
  const priorityRaw = prompt('Rank priority (higher = more power)', String(target.rankPriority ?? 0));
  if (priorityRaw === null) return;
  const nextPriority = Math.max(0, Number(priorityRaw) || 0);
  const nextLabel = label.trim() || 'Member';

  if (getPriority(userProfile) <= nextPriority && !isOwner(userProfile)) {
    return showToast('You cannot assign a rank equal to or above your own.');
  }

  await updateDoc(doc(db, 'users', uid), { role: nextLabel, rankPriority: nextPriority });
  showToast('Rank updated.');
  await refreshAdminPanel();
};

window.toggleVerified = async (uid, verified) => {
  const targetSnap = await getDoc(doc(db, 'users', uid));
  const target = normalizeUser(uid, targetSnap.data() || {});
  if (!canModerate(target)) return showToast('You cannot change this user.');
  if (isOwner(target)) return showToast('Owner cannot be modified.');
  await updateDoc(doc(db, 'users', uid), { verified: !verified, verifiedRequested: false });
  showToast(verified ? 'Verification removed.' : 'User verified.');
  await refreshAdminPanel();
};

window.toggleBan = async (uid, banned, labelName = 'user') => {
  const targetSnap = await getDoc(doc(db, 'users', uid));
  const target = normalizeUser(uid, targetSnap.data() || {});
  if (!canModerate(target)) return showToast('You cannot change this user.');
  if (isOwner(target)) return showToast('Owner cannot be banned.');

  if (!banned) {
    const reason = prompt(`Ban reason for ${labelName}:`, 'Violation of rules');
    if (reason === null) return;
    await updateDoc(doc(db, 'users', uid), { banned: true, banReason: reason.trim() || 'Violation of rules', bannedAt: Date.now(), bannedBy: currentUid() });
    showToast('User banned.');
  } else {
    await updateDoc(doc(db, 'users', uid), { banned: false, banReason: '', bannedAt: null, bannedBy: '' });
    showToast('User unbanned.');
  }
  await refreshAdminPanel();
};

window.toggleUserMute = async (uid, muted) => {
  const targetSnap = await getDoc(doc(db, 'users', uid));
  const target = normalizeUser(uid, targetSnap.data() || {});
  if (!canModerate(target)) return showToast('You cannot change this user.');
  if (isOwner(target)) return showToast('Owner cannot be muted.');
  await updateDoc(doc(db, 'users', uid), { muted: !muted });
  showToast(muted ? 'User unmuted.' : 'User muted.');
  await refreshAdminPanel();
};

async function bulkActionVisible(mode) {
  const visible = visibleUsersFilter(adminUsersCache);
  if (!visible.length) return showToast('Nothing visible to change.');
  if (!confirm(`${mode} ${visible.length} visible users?`)) return;
  for (const u of visible) {
    if (!canModerate(u) || isOwner(u)) continue;
    const ref = doc(db, 'users', u.uid);
    if (mode === 'Mute') await updateDoc(ref, { muted: true });
    if (mode === 'Unmute') await updateDoc(ref, { muted: false });
    if (mode === 'Ban') await updateDoc(ref, { banned: true, banReason: 'Bulk action', bannedAt: Date.now(), bannedBy: currentUid() });
    if (mode === 'Unban') await updateDoc(ref, { banned: false, banReason: '', bannedAt: null, bannedBy: '' });
  }
  await refreshAdminPanel();
}

document.getElementById('adminBtn').onclick = async () => {
  if (!isStaff(userProfile)) return showToast('No permission.');
  document.getElementById('adminModal').style.display = 'flex';
  document.getElementById('adminUserList').innerHTML = 'Fetching...';
  await refreshAdminPanel();
};
document.getElementById('refreshAdminBtn').onclick = refreshAdminPanel;
document.getElementById('customRankRefreshBtn').onclick = refreshAdminPanel;
document.getElementById('adminSearch').oninput = refreshAdminPanel;
document.getElementById('adminFilter').onchange = refreshAdminPanel;
document.getElementById('muteAllBtn').onclick = () => bulkActionVisible('Mute');
document.getElementById('unmuteAllBtn').onclick = () => bulkActionVisible('Unmute');
document.getElementById('banAllBtn').onclick = () => bulkActionVisible('Ban');
document.getElementById('unbanAllBtn').onclick = () => bulkActionVisible('Unban');
document.getElementById('createRankBtn').onclick = async () => {
  if (!isStaff(userProfile)) return showToast('No permission.');
  const label = document.getElementById('rankLabelInput').value.trim();
  const priority = Number(document.getElementById('rankPriorityInput').value || 0);
  if (!label) return showToast('Enter a rank label.');
  if (priority >= getPriority(userProfile) && !isOwner(userProfile)) return showToast('You cannot create a rank at or above your own priority.');
  const uid = prompt('User ID to apply this rank to?');
  if (!uid) return;
  const targetSnap = await getDoc(doc(db, 'users', uid.trim()));
  if (!targetSnap.exists()) return showToast('User not found.');
  const target = normalizeUser(uid.trim(), targetSnap.data() || {});
  if (!canModerate(target) || isOwner(target)) return showToast('You cannot modify this user.');
  await updateDoc(doc(db, 'users', uid.trim()), { role: label, rankPriority: priority });
  showToast('Rank applied.');
  await refreshAdminPanel();
};

// PROFILE + POST ACTIONS
window.navProfile = () => openProfile(currentUid());
document.getElementById('navProfileBtn').onclick = () => openProfile(currentUid());

// ADMIN-ONLY FIRESTORE HELPERS

// (Optional helper if you later expand admin tools)
async function forceDeleteUser(uid) {
  if (!isOwner(userProfile)) return showToast('Owner only action.');
  if (!confirm('Permanently delete this user document?')) return;
  await deleteDoc(doc(db, 'users', uid));
  showToast('User deleted.');
  await refreshAdminPanel();
}

// GLOBAL ESC KEY CLOSE (nice UX)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

// CLICK OUTSIDE MODAL TO CLOSE
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModals();
  });
});

// BASIC NAV ACTIVE STATE (visual polish)
const navButtons = document.querySelectorAll('.nav-btn');
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// SAFETY: Prevent empty profile crash edge case
if (!window.viewUserProfile) {
  window.viewUserProfile = (uid) => openProfile(uid);
}

// INITIAL UI STATE FIXES
window.addEventListener('load', () => {
  document.getElementById('feed').innerHTML = '<div class="tiny">Loading feed...</div>';
});
