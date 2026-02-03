import { createSlice } from "@reduxjs/toolkit";

// Hydrate any existing local session created via the local API shim.
let initialUser = null;
let initialToken = null;

if (typeof window !== "undefined") {
  try {
    const storedUser = window.localStorage.getItem("arb_user");
    const storedToken = window.localStorage.getItem("arb_token") || window.localStorage.getItem("token");
    if (storedUser) {
      initialUser = JSON.parse(storedUser);
    }
    if (storedToken) {
      initialToken = storedToken;
    }
  } catch {
    // ignore hydration errors and fall back to defaults
  }
}

const authSlice = createSlice({
  name: "auth",
  initialState: {
    token: initialToken || "local_token",
    user:
      initialUser || {
        _id: "local_user",
        name: "Joe Doe",
        email: "joe@example.com",
      },
    loading: false,
  },
  reducers: {
    login: (state, action) => {
      state.token = action.payload.token;
      state.user = action.payload.user;
      try {
        window.localStorage.setItem("arb_user", JSON.stringify(state.user));
        window.localStorage.setItem("arb_token", state.token);
      } catch {
        // ignore storage failures in read-only environments
      }
    },
    logout: (state) => {
      state.token = "";
      state.user = null;
      try {
        window.localStorage.removeItem("arb_user");
        window.localStorage.removeItem("arb_token");
        window.localStorage.removeItem("token");
      } catch {
        // ignore
      }
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
  },
});

export const { login, logout, setLoading } = authSlice.actions;

export default authSlice.reducer;