import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, orderBy, addDoc, arrayUnion, arrayRemove, increment } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

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
let feedUnsubscribe = null;
let allPostsCache = [];
let postImage = "";
let isLoginMode = true;
let isPosting = false;
let selectedProfileUid = null;
let feedMode = "newest";

const $ = (id) => document.getElementById(id);
const escapeHTML = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHandle = (name = "user") => "@" + String(name).toLowerCase().replace(/\s+/g, "");
const fallbackPfp = (name = "User", seed = "user") => "https://ui-avatars.com/api/?name=" + encodeURIComponent(name || seed) + "&background=16161d&color=fff&bold=true";
const currentUid = () => auth.currentUser?.uid || "";
const getRole = (user) => String(user?.rank ?? user?.role ?? "member").trim().toLowerCase();
const isStaff = (user) => ["mod", "moderator", "admin", "owner"].includes(getRole(user)) || Number(user?.rankPriority || 0) >= 500;
const isOwner = (user) => getRole(user) === "owner" || Number(user?.rankPriority || 0) >= 1000;
const normalizeUser = (uid, data = {}) => ({
  uid,
  name: data.name || "User",
  email: data.email || "",
  pfp: data.pfp || fallbackPfp(data.name || "User", uid),
  role: data.rank || data.role || "Member",
  rankPriority: Number(data.rankPriority || 0),
  muted: !!data.muted,
  banned: !!data.banned,
  verified: !!data.verified,
  verifiedRequested: !!data.verifiedRequested,
  bio: data.bio || "New to Mobify.",
  status: data.status || "Online"
});
const showToast = (message) => {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  $("toast-container").appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
};
const refreshIcons = () => window.lucide?.createIcons();

function setModal(id, open) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", String(!open));
}

function updateProfileUI() {
  if (!userProfile) return;
  const pfp = userProfile.pfp || fallbackPfp(userProfile.name, userProfile.uid);
  ["composerAvatar", "sideAvatar", "navAvatar"].forEach(id => {
    const image = $(id);
    if (image) image.src = pfp;
  });
  $("sideName").textContent = userProfile.name;
  $("sideHandle").textContent = safeHandle(userProfile.name);
  $("adminNav").classList.toggle("is-hidden", !isStaff(userProfile));
}

function openView(name) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active-view", view.dataset.view === name));
  document.querySelectorAll(".nav-item[data-view-target]").forEach(button => button.classList.toggle("active", button.dataset.viewTarget === name));
  if (name === "messages") $("content-shell")?.scrollTo?.({ top: 0, behavior: "smooth" });
}

function requireActionPermission() {
  if (userProfile?.banned) {
    showToast("Your account is banned from posting or interacting.");
    return false;
  }
  if (userProfile?.muted) {
    showToast("Your account is currently muted.");
    return false;
  }
  return true;
}

function renderTrends(posts) {
  const counts = {};
  posts.forEach(post => (post.text || "").match(/#[\w-]+/g)?.forEach(tag => counts[tag.toLowerCase()] = (counts[tag.toLowerCase()] || 0) + 1));
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $("trendsList").innerHTML = entries.length ? entries.map(([tag, count]) => `<button class="tag-item" data-tag="${escapeHTML(tag)}"><span>${escapeHTML(tag)}</span><small>${count} posts</small></button>`).join("") : "<p class=\"empty-rail\">No tags are trending yet.</p>";
  document.querySelectorAll(".tag-item").forEach(button => button.onclick = () => {
    openView("messages");
    const tag = button.dataset.tag.toLowerCase();
    document.querySelectorAll(".post").forEach(card => card.hidden = !card.textContent.toLowerCase().includes(tag));
  });
}

function postScore(post) {
  return (post.likes?.length || 0) * 2 + (post.comments?.length || 0) * 3 + (post.views || 0) * 0.1;
}

function renderFeed() {
  const posts = [...allPostsCache].filter(post => !post.groupId);
  posts.sort((a, b) => feedMode === "popular" ? postScore(b) - postScore(a) : (b.timestamp || 0) - (a.timestamp || 0));
  const feed = $("feed");
  feed.innerHTML = "";
  if (!posts.length) {
    feed.innerHTML = '<div class="empty-feed glass-panel"><i data-lucide="sparkles"></i><h3>Your feed is ready.</h3><p>Be the first person to start the conversation.</p></div>';
    refreshIcons();
    return;
  }
  posts.forEach(post => feed.appendChild(renderPost(post)));
  refreshIcons();
}

function renderPost(post) {
  const article = document.createElement("article");
  article.className = "post" + (post.pinned ? " pinned" : "");
  const author = normalizeUser(post.authorId || "", { name: post.authorName, pfp: post.authorPfp, role: post.authorRole, rankPriority: post.authorPriority, verified: post.authorVerified });
  const liked = (post.likes || []).includes(currentUid());
  article.innerHTML = `
    <img class="avatar post-avatar" src="${author.pfp}" alt="" data-profile="${escapeHTML(post.authorId || "")}">
    <div class="post-main">
      <div class="post-meta">
        <button class="post-author" data-profile="${escapeHTML(post.authorId || "")}">${escapeHTML(author.name)}</button>
        ${author.verified ? '<span class="verified-mark" title="Verified">✓</span>' : ""}
        <span>${safeHandle(author.name)}</span>
        ${post.pinned ? '<span class="pin-label">Pinned</span>' : ""}
      </div>
      <button class="post-body-button" data-detail="${escapeHTML(post.id)}"><div class="post-body">${escapeHTML(post.text || "")}</div>${post.image ? `<img class="post-media" src="${post.image}" alt="Post image">` : ""}</button>
      <div class="post-actions">
        <button class="post-action ${liked ? "liked" : ""}" data-like="${post.id}" aria-label="Like"><i data-lucide="heart"></i><span>${post.likes?.length || 0}</span></button>
        <button class="post-action" data-detail="${post.id}" aria-label="Comments"><i data-lucide="message-circle"></i><span>${post.comments?.length || 0}</span></button>
        <button class="post-action" data-detail="${post.id}" aria-label="Post statistics"><i data-lucide="bar-chart-3"></i><span>${post.views || 0}</span></button>
      </div>
    </div>`;
  article.querySelectorAll("[data-profile]").forEach(button => button.onclick = () => openProfile(button.dataset.profile));
  article.querySelectorAll("[data-detail]").forEach(button => button.onclick = () => showDetail(button.dataset.detail));
  article.querySelector("[data-like]")?.addEventListener("click", event => {
    event.stopPropagation();
    toggleLike(post.id);
  });
  return article;
}

async function toggleLike(postId) {
  if (!requireActionPermission()) return;
  const ref = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const likes = snap.data().likes || [];
  await updateDoc(ref, { likes: likes.includes(currentUid()) ? arrayRemove(currentUid()) : arrayUnion(currentUid()) });
}

async function showDetail(postId) {
  const post = allPostsCache.find(item => item.id === postId);
  if (!post) return;
  const ref = doc(db, "posts", postId);
  updateDoc(ref, { views: increment(1) }).catch(() => {});
  const comments = post.comments || [];
  $("detailContent").innerHTML = `
    <div class="detail-post"><h3>Post</h3><p>${escapeHTML(post.text || "")}</p>${post.image ? `<img class="post-media" src="${post.image}" alt="Post image">` : ""}</div>
    <div class="stats-row"><div><small>Views</small><strong>${post.views || 0}</strong></div><div><small>Likes</small><strong>${post.likes?.length || 0}</strong></div><div><small>Comments</small><strong>${comments.length}</strong></div></div>
    <div class="comments"><h4>Comments</h4>${comments.map(comment => `<div class="comment"><strong>${escapeHTML(comment.name || "User")}</strong><p>${escapeHTML(comment.text || "")}</p></div>`).join("") || "<p class=\"empty-comments\">No comments yet.</p>"}</div>
    <div class="comment-composer"><input id="detailCommentInput" placeholder="Write a comment..."><button id="sendDetailComment" class="primary-button">Send</button></div>`;
  $("sendDetailComment").onclick = async () => {
    const input = $("detailCommentInput");
    const text = input.value.trim();
    if (!text || !requireActionPermission()) return;
    await updateDoc(ref, { comments: arrayUnion({ uid: currentUid(), name: userProfile.name, pfp: userProfile.pfp, text, time: Date.now() }) });
    input.value = "";
  };
  setModal("detailModal", true);
}

async function openProfile(uid) {
  if (!uid) return;
  selectedProfileUid = uid;
  const snap = await getDoc(doc(db, "users", uid));
  const profile = normalizeUser(uid, snap.exists() ? snap.data() : {});
  $("profPfp").src = profile.pfp;
  $("profName").textContent = profile.name;
  $("profBio").textContent = profile.bio;
  $("profStatus").textContent = profile.status;
  $("profBadgeSlot").innerHTML = `${profile.verified ? '<span class="profile-badge">Verified</span>' : ""}${profile.role && String(profile.role).toLowerCase() !== "member" ? `<span class="profile-badge">${escapeHTML(profile.role)}</span>` : ""}`;
  $("profileEditBtn").classList.toggle("is-hidden", uid !== currentUid());
  $("verifyRequestBtn").classList.toggle("is-hidden", uid !== currentUid());
  setModal("profileModal", true);
}

async function submitPost() {
  if (isPosting || !requireActionPermission()) return;
  const text = $("postText").value.trim();
  if (!text && !postImage) return;
  isPosting = true;
  $("submitPostBtn").disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
      authorId: currentUid(),
      authorName: userProfile.name,
      authorPfp: userProfile.pfp,
      authorRole: userProfile.role,
      authorPriority: userProfile.rankPriority || 0,
      authorVerified: !!userProfile.verified,
      text,
      image: postImage,
      timestamp: Date.now(),
      views: 0,
      likes: [],
      comments: [],
      pinned: false
    });
    $("postText").value = "";
    postImage = "";
    $("postImagePreview").innerHTML = "";
    $("postImagePreview").classList.add("is-hidden");
    setModal("composerModal", false);
  } catch (error) {
    showToast(error.message || "Could not publish that post.");
  } finally {
    isPosting = false;
    $("submitPostBtn").disabled = false;
  }
}

function startFeed() {
  if (feedUnsubscribe) feedUnsubscribe();
  feedUnsubscribe = onSnapshot(query(collection(db, "posts"), orderBy("timestamp", "desc")), snapshot => {
    allPostsCache = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderFeed();
    renderTrends(allPostsCache);
  }, error => showToast(error.message || "Could not load the feed."));
}

$("toggleAuth").onclick = () => {
  isLoginMode = !isLoginMode;
  $("authTitle").textContent = isLoginMode ? "Mobify" : "Join Mobify";
  $("authNameWrap").classList.toggle("is-hidden", isLoginMode);
  $("authBtn").textContent = isLoginMode ? "Sign in" : "Create account";
  $("toggleAuth").innerHTML = isLoginMode ? 'New here? <strong>Create an account</strong>' : 'Already have an account? <strong>Sign in</strong>';
};

$("authForm").onsubmit = async event => {
  event.preventDefault();
  try {
    const email = $("authEmail").value.trim();
    const password = $("authPass").value;
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const name = $("authName").value.trim() || "User";
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", result.user.uid), {
        name, email, pfp: fallbackPfp(name, result.user.uid), role: "Member", rank: "member", rankPriority: 0,
        muted: false, banned: false, verified: false, verifiedRequested: false,
        bio: "New to Mobify.", status: "Online", createdAt: Date.now()
      });
    }
  } catch (error) {
    showToast(error.message);
  }
};

$("logoutBtn").onclick = () => signOut(auth);
$("openComposer").onclick = () => setModal("composerModal", true);
$("fab").onclick = () => setModal("composerModal", true);
$("composerPhoto").onclick = () => $("postFileInput").click();
$("submitPostBtn").onclick = submitPost;
$("refreshFeedBtn").onclick = () => renderFeed();
$("brandHome").onclick = () => openView("messages");
$("profileNav").onclick = () => openProfile(currentUid());
document.querySelectorAll("[data-close-modal]").forEach(button => button.onclick = () => setModal(button.dataset.closeModal, false));
document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) setModal(modal.id, false); }));
document.querySelectorAll(".nav-item[data-view-target]").forEach(button => button.onclick = () => openView(button.dataset.viewTarget));
document.querySelectorAll(".feed-filter").forEach(button => button.onclick = () => {
  feedMode = button.dataset.feedFilter;
  document.querySelectorAll(".feed-filter").forEach(item => item.classList.toggle("active", item === button));
  renderFeed();
});
$("postFileInput").onchange = event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Please choose an image file.");
  const reader = new FileReader();
  reader.onload = () => {
    postImage = reader.result;
    $("postImagePreview").innerHTML = `<img src="${postImage}" alt="Selected image"><button id="removePostImage" class="icon-button" type="button"><i data-lucide="x"></i></button>`;
    $("postImagePreview").classList.remove("is-hidden");
    $("removePostImage").onclick = () => { postImage = ""; $("postFileInput").value = ""; $("postImagePreview").innerHTML = ""; $("postImagePreview").classList.add("is-hidden"); };
    refreshIcons();
  };
  reader.readAsDataURL(file);
};

$("profileEditBtn").onclick = () => showToast("Profile editing moves into the settings work in Part 4.");
$("verifyRequestBtn").onclick = async () => {
  if (selectedProfileUid !== currentUid() || userProfile.verified || userProfile.verifiedRequested) return;
  await updateDoc(doc(db, "users", currentUid()), { verifiedRequested: true });
  userProfile.verifiedRequested = true;
  showToast("Verification requested.");
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    userProfile = null;
    $("auth-container").classList.remove("hidden");
    $("app-container").classList.add("hidden");
    if (feedUnsubscribe) { feedUnsubscribe(); feedUnsubscribe = null; }
    return;
  }
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { name: user.displayName || "User", email: user.email || "", pfp: fallbackPfp(user.displayName || "User", user.uid), role: "Member", rank: "member", rankPriority: 0, muted: false, banned: false, verified: false, verifiedRequested: false, bio: "New to Mobify.", status: "Online", createdAt: Date.now() });
  }
  const fresh = await getDoc(ref);
  userProfile = normalizeUser(user.uid, fresh.data() || {});
  $("auth-container").classList.add("hidden");
  $("app-container").classList.remove("hidden");
  updateProfileUI();
  startFeed();
  refreshIcons();
});

refreshIcons();

const APPEARANCE_KEY='mobify.appearance.v1';
const DEFAULT_APPEARANCE={theme:'dark',accent:'#9b8cff',glass:28,reduceMotion:false};
function applyAppearance(v){const x={...DEFAULT_APPEARANCE,...v};document.documentElement.dataset.theme=x.theme;document.documentElement.style.setProperty('--accent',x.accent);document.documentElement.style.setProperty('--accent-2',x.accent);document.documentElement.style.setProperty('--glass-blur',x.glass+'px');localStorage.setItem(APPEARANCE_KEY,JSON.stringify(x));}
function loadAppearance(){try{return {...DEFAULT_APPEARANCE,...JSON.parse(localStorage.getItem(APPEARANCE_KEY)||'{}')}}catch{return DEFAULT_APPEARANCE}}
let trendCategory='comments';
function renderTrending(){const root=$('trendingFeed');if(!root)return;const p=[...allPostsCache];p.sort((a,b)=>{const n=x=>trendCategory==='views'?(x.views||0):trendCategory==='likes'?(x.likes?.length||0):trendCategory==='comments'?(x.comments?.length||0):postScore(x);return n(b)-n(a)});root.innerHTML='';p.slice(0,12).forEach(x=>root.appendChild(renderPost(x)));if(!p.length)root.innerHTML='<div class="empty-feed glass-panel">Nothing trending yet.</div>';refreshIcons();}

const ext=$('openConferExternal');if(ext)ext.onclick=()=>window.open('https://itsmeh1.github.io/confer/confer.html?.amplify.com','_blank','noopener');
document.querySelectorAll('[data-trend-category]').forEach(b=>b.onclick=()=>{trendCategory=b.dataset.trendCategory;document.querySelectorAll('[data-trend-category]').forEach(x=>x.classList.toggle('active',x===b));renderTrending()});
document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>applyAppearance({...loadAppearance(),theme:b.dataset.theme}));
document.querySelectorAll('[data-accent]').forEach(b=>b.onclick=()=>applyAppearance({...loadAppearance(),accent:b.dataset.accent}));
const glass=$('glassIntensity');if(glass)glass.oninput=e=>applyAppearance({...loadAppearance(),glass:Number(e.target.value)});
const reset=$('resetAppearance');if(reset)reset.onclick=()=>applyAppearance(DEFAULT_APPEARANCE);applyAppearance(loadAppearance());
