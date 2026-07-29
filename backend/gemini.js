// Google Gemini backend for the doubt-solving chat and AI-generated assessments.
// Uses the plain REST API via global fetch (Node 18+) rather than an SDK, so no
// extra dependency is needed. Get a key at https://aistudio.google.com/apikey.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const TUTOR_SYSTEM_PROMPT = `You are a patient, precise interview-prep tutor for a learner named Moushana who is
studying Core Java, Selenium/automation, REST APIs, SQL, Spring Boot and Spring Security to become job-ready for
SDET, automation, and Java/Spring backend roles. Answer doubts clearly and concisely, using short paragraphs or
bullet points, include a small code example when it clarifies the concept, and end with one sentence connecting
it back to what an interviewer would probe next. Do not pad with filler.`;

async function callGemini(systemInstruction, userText, { temperature = 0.4, jsonMode = false } = {}) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Gemini error ${resp.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Gemini returned no content (possibly blocked by safety filters)');
  return text;
}

async function answerDoubt(question, topic) {
  const userText = topic ? `Topic: ${topic}\n\nQuestion: ${question}` : question;
  const text = await callGemini(TUTOR_SYSTEM_PROMPT, userText, { temperature: 0.4 });
  return text.trim();
}

async function generateAssessment(phaseTitle, topicName, count = 5) {
  const sys = `You write multiple-choice interview-prep questions for a Java/Spring/Selenium/SDET learner.
Return STRICT JSON only, matching this shape:
{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}
Exactly 4 options per question, answerIndex is 0-based, and the explanation must justify the correct answer in one sentence.
Do not include markdown, prose, or anything outside the JSON object.`;
  const userText = `Phase: ${phaseTitle}. Topic: ${topicName}. Write ${count} questions of realistic interview difficulty for this specific topic.`;
  const text = await callGemini(sys, userText, { temperature: 0.6, jsonMode: true });
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
    throw new Error('Model did not return usable questions');
  }
  return parsed.questions;
}

module.exports = { answerDoubt, generateAssessment };
