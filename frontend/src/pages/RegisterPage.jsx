import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setAuthToken } from "../api";

function isMongoObjectId(value) {
  return /^[a-fA-F0-9]{24}$/.test(value);
}

const RegisterPage = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [collegeId, setCollegeId] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedCollegeId = collegeId.trim();

    if (trimmedCollegeId && !isMongoObjectId(trimmedCollegeId)) {
      setError("College ID must be a valid 24-character Mongo ObjectId.");
      return;
    }

    try {
      const payload = {
        name,
        email,
        password,
        role
      };

      if (trimmedCollegeId) {
        payload.collegeId = trimmedCollegeId;
      }

      const res = await api.post("/api/auth/register", payload);
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
        err.message ||
        "Registration failed";
      setError(msg);
    }
  };

  return (
    <div className="container">
      <h2>Create User</h2>
      {error && <p style={{ color: "#dc3545" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
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
        <div className="form-group">
          <label>Role:</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="student">student</option>
            <option value="faculty">faculty</option>
            <option value="admin">admin</option>
            <option value="superadmin">superadmin</option>
          </select>
        </div>
        <div className="form-group">
          <label>College ID (optional, 24-char ObjectId):</label>
          <input
            type="text"
            value={collegeId}
            onChange={(e) => setCollegeId(e.target.value)}
          />
        </div>
        <button type="submit" className="button">
          Create User
        </button>
      </form>
    </div>
  );
};

export default RegisterPage;
