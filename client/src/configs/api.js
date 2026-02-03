/**
 * Local (browser-only) API shim.
 *
 * Why: this project originally depended on a Node/Express backend. To make the
 * app deploy as a static site (S3/CloudFront, Nginx on EC2, etc.), we replace
 * those HTTP calls with localStorage-backed logic while keeping the UI and
 * call-sites unchanged.
 *
 * Shape: mimics a small subset of Axios' API used by the app:
 * - api.get(url, config?)
 * - api.post(url, data?, config?)
 * - api.put(url, data?, config?)
 * - api.delete(url, config?)
 *
 * Returns: Promise<{ data: any }>
 * Errors: throws an object with { response: { status, data: { message } } }
 */

const LS_KEYS = {
  user: "arb_user",
  token: "arb_token",
  resumes: "arb_resumes",
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "res") {
  // Good enough for local-only usage.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureSeed() {
  const existingUser = readJson(LS_KEYS.user, null);
  if (!existingUser) {
    writeJson(LS_KEYS.user, {
      _id: "local_user",
      name: "Joe Doe",
      email: "joe@example.com",
    });
  }

  const existingToken = localStorage.getItem(LS_KEYS.token);
  if (!existingToken) {
    localStorage.setItem(LS_KEYS.token, "local_token");
  }

  const existingResumes = readJson(LS_KEYS.resumes, null);
  if (!existingResumes) {
    writeJson(LS_KEYS.resumes, []);
  }
}

function axiosLikeError(message, status = 400) {
  return {
    message,
    response: {
      status,
      data: { message },
    },
  };
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function getResumes() {
  ensureSeed();
  return readJson(LS_KEYS.resumes, []);
}

function setResumes(resumes) {
  writeJson(LS_KEYS.resumes, resumes);
}

function findResume(resumeId) {
  const resumes = getResumes();
  return resumes.find((r) => r._id === resumeId) || null;
}

function upsertResume(updated) {
  const resumes = getResumes();
  const idx = resumes.findIndex((r) => r._id === updated._id);
  if (idx >= 0) resumes[idx] = updated;
  else resumes.push(updated);
  setResumes(resumes);
}

function normalizeUrl(url) {
  if (!url) return "/";
  return url.startsWith("/") ? url : `/${url}`;
}

function enhanceText(prompt) {
  // Keep it simple and deterministic. The UI expects "enhancedContent".
  // We try to extract quoted content if present: enhance my ... "CONTENT"
  const match = prompt?.match(/"([\s\S]*)"/);
  const base = (match?.[1] ?? prompt ?? "").toString().trim();
  if (!base) return "";
  // Light “enhancement”: normalize whitespace and add a strong opening if short.
  const cleaned = base.replace(/\s+/g, " ").trim();
  if (cleaned.length < 80) {
    return `Results-driven professional with a strong focus on impact. ${cleaned}`;
  }
  return cleaned;
}

async function handleRequest(method, url, body) {
  ensureSeed();
  const path = normalizeUrl(url);

  // ---- Users ----
  if (method === "GET" && path === "/api/users/data") {
    const user = readJson(LS_KEYS.user, null);
    return { user };
  }

  if (method === "GET" && path === "/api/users/resumes") {
    const resumes = getResumes()
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { resumes };
  }

  if (method === "POST" && (path === "/api/users/login" || path === "/api/users/register")) {
    const token = "local_token";
    const user = {
      _id: "local_user",
      name: body?.name?.trim() || "Joe Doe",
      email: body?.email?.trim() || "joe@example.com",
    };
    writeJson(LS_KEYS.user, user);
    localStorage.setItem(LS_KEYS.token, token);
    return {
      token,
      user,
      message: path.endsWith("register") ? "Registered (local)" : "Logged in (local)",
    };
  }

  // ---- Resumes ----
  if (method === "POST" && path === "/api/resumes/create") {
    const title = (body?.title || "Untitled Resume").toString();
    const resume = {
      _id: makeId("resume"),
      title,
      personal_info: {},
      professional_summary: "",
      experience: [],
      education: [],
      project: [],
      skills: [],
      template: "classic",
      accent_color: "#3B82F6",
      public: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    upsertResume(resume);
    return { resume, message: "Resume created" };
  }

  const getMatch = path.match(/^\/api\/resumes\/get\/(.+)$/);
  if (method === "GET" && getMatch) {
    const resumeId = decodeURIComponent(getMatch[1]);
    const resume = findResume(resumeId);
    if (!resume) throw axiosLikeError("Resume not found", 404);
    return { resume };
  }

  const publicMatch = path.match(/^\/api\/resumes\/public\/(.+)$/);
  if (method === "GET" && publicMatch) {
    const resumeId = decodeURIComponent(publicMatch[1]);
    const resume = findResume(resumeId);
    if (!resume || !resume.public) throw axiosLikeError("Resume not found", 404);
    return { resume };
  }

  if (method === "PUT" && path === "/api/resumes/update") {
    // Supports either { resumeId, resumeData } or FormData with resumeId + resumeData JSON.
    let resumeId;
    let resumeData;
    let imageFile;

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      resumeId = body.get("resumeId");
      const resumeDataRaw = body.get("resumeData");
      resumeData = resumeDataRaw ? JSON.parse(resumeDataRaw.toString()) : {};
      const maybeImage = body.get("image");
      if (maybeImage && typeof maybeImage === "object") imageFile = maybeImage;
      // removeBackground is ignored in local mode (kept for UI compatibility)
    } else {
      resumeId = body?.resumeId;
      resumeData = body?.resumeData || {};
    }

    if (!resumeId) throw axiosLikeError("resumeId is required", 400);
    const existing = findResume(resumeId);
    if (!existing) throw axiosLikeError("Resume not found", 404);

    const next = {
      ...existing,
      ...resumeData,
      personal_info: {
        ...(existing.personal_info || {}),
        ...(resumeData.personal_info || {}),
      },
      updatedAt: nowIso(),
    };

    if (imageFile) {
      try {
        const dataUrl = await fileToDataUrl(imageFile);
        next.personal_info = { ...(next.personal_info || {}), image: dataUrl };
      } catch {
        // If conversion fails, keep existing image as-is.
      }
    }

    upsertResume(next);
    return { resume: next, message: "Resume updated" };
  }

  const deleteMatch = path.match(/^\/api\/resumes\/delete\/(.+)$/);
  if (method === "DELETE" && deleteMatch) {
    const resumeId = decodeURIComponent(deleteMatch[1]);
    const resumes = getResumes();
    const next = resumes.filter((r) => r._id !== resumeId);
    setResumes(next);
    return { message: "Resume deleted" };
  }

  // ---- AI (local placeholder) ----
  if (method === "POST" && path === "/api/ai/enhance-pro-sum") {
    return { enhancedContent: enhanceText(body?.userContent) };
  }

  if (method === "POST" && path === "/api/ai/enhance-job-desc") {
    return { enhancedContent: enhanceText(body?.userContent) };
  }

  if (method === "POST" && path === "/api/ai/upload-resume") {
    // Create a new resume from extracted PDF text. We keep this very lightweight.
    const title = (body?.title || "Uploaded Resume").toString();
    const resumeText = (body?.resumeText || "").toString();
    const resume = {
      _id: makeId("resume"),
      title,
      personal_info: {},
      professional_summary: resumeText.trim().slice(0, 600),
      experience: [],
      education: [],
      project: [],
      skills: [],
      template: "classic",
      accent_color: "#3B82F6",
      public: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    upsertResume(resume);
    return { resumeId: resume._id, message: "Resume uploaded" };
  }

  throw axiosLikeError(`No local route for ${method} ${path}`, 404);
}

const api = {
  async get(url, config) {
    try {
      const data = await handleRequest("GET", url, undefined, config);
      return { data };
    } catch (err) {
      throw err;
    }
  },
  async post(url, body, config) {
    try {
      const data = await handleRequest("POST", url, body, config);
      return { data };
    } catch (err) {
      throw err;
    }
  },
  async put(url, body, config) {
    try {
      const data = await handleRequest("PUT", url, body, config);
      return { data };
    } catch (err) {
      throw err;
    }
  },
  async delete(url, config) {
    try {
      const data = await handleRequest("DELETE", url, undefined, config);
      return { data };
    } catch (err) {
      throw err;
    }
  },
};

export default api;
