import User from "../../models/User.mjs";
import Problem from "../../models/Problem.mjs";
import Question from "../../models/Question.mjs";
import Assessment from "../../models/Assessment.mjs";
import AssessmentAttempt from "../../models/AssessmentAttempt.mjs";
import Submission from "../../models/Submission.mjs";
import AuditLog from "../../models/AuditLog.mjs";
import SystemSettings from "../../models/SystemSettings.mjs";

// Helper to get a setting
export async function getSetting(key, defaultValue = null) {
  const doc = await SystemSettings.findOne({ key });
  return doc ? doc.value : defaultValue;
}

// Helper to set a setting
export async function setSetting(key, value) {
  const result = await SystemSettings.findOneAndUpdate(
    { key },
    { value },
    { upsert: true, new: true }
  );
  return result.value;
}

// Get the incident banner
export async function getIncidentBanner() {
  return getSetting("incident_banner", { active: false, message: "", type: "info" });
}

// Update the incident banner
export async function updateIncidentBanner({ active, message, type }) {
  return setSetting("incident_banner", { active: !!active, message: message || "", type: type || "info" });
}

// Backup database state to a JSON object
export async function exportDatabase() {
  const collections = {
    users: await User.find({}),
    problems: await Problem.find({}),
    questions: await Question.find({}),
    assessments: await Assessment.find({}),
    assessmentattempts: await AssessmentAttempt.find({}),
    submissions: await Submission.find({}),
    auditlogs: await AuditLog.find({}),
    systemsettings: await SystemSettings.find({})
  };
  return collections;
}

// Restore database state from a JSON object
export async function importDatabase(data) {
  if (!data || typeof data !== 'object') {
    throw new Error("Invalid backup data format");
  }

  const supportedCollections = [
    { name: "users", model: User },
    { name: "problems", model: Problem },
    { name: "questions", model: Question },
    { name: "assessments", model: Assessment },
    { name: "assessmentattempts", model: AssessmentAttempt },
    { name: "submissions", model: Submission },
    { name: "auditlogs", model: AuditLog },
    { name: "systemsettings", model: SystemSettings }
  ];

  const results = {};

  for (const col of supportedCollections) {
    if (data[col.name] && Array.isArray(data[col.name])) {
      // Clear current collection
      await col.model.deleteMany({});
      
      // If there are documents, insert them
      if (data[col.name].length > 0) {
        // Ensure documents preserve original _id
        await col.model.insertMany(data[col.name]);
      }
      results[col.name] = data[col.name].length;
    }
  }

  return results;
}
