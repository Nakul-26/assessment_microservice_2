import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setAuthToken } from "../api";

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const res = await api.post("/api/auth/login", { email, password });
      const { token, user } = res.data;
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      setAuthToken(token);
      window.dispatchEvent(new Event("auth-change"));
      navigate("/");
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.msg ||
        "Login failed";
      setError(msg);
    }
  };

  return (
    <div className="container">
      <h2>Login</h2>
      {error && <p style={{ color: "#dc3545" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label>Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="button">
          Login
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
