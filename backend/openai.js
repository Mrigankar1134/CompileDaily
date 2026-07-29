const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const TUTOR_SYSTEM_PROMPT = `You are a patient, precise interview-prep tutor for a learner named Moushana who is
studying Core Java, Selenium/automation, REST APIs, SQL, Spring Boot and Spring Security to become job-ready for
SDET, automation, and Java/Spring backend roles. Answer doubts clearly and concisely, using short paragraphs or
bullet points, include a small code example when it clarifies the concept, and end with one sentence connecting
it back to what an interviewer would probe next. Do not pad with filler.`;

async function answerDoubt(question, topic) {
  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    messages: [
      { role: 'system', content: TUTOR_SYSTEM_PROMPT },
      { role: 'user', content: topic ? `Topic: ${topic}\n\nQuestion: ${question}` : question }
    ]
  });
  return resp.choices[0].message.content.trim();
}

async function generateAssessment(phaseTitle, topicName, count = 5) {
  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You write multiple-choice interview-prep questions for a Java/Spring/Selenium/SDET learner.
Return STRICT JSON only, matching this shape:
{"questions":[{"q":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}
Exactly 4 options per question, answerIndex is 0-based, and the explanation must justify the correct answer in one sentence.
Do not include markdown, prose, or anything outside the JSON object.`
      },
      {
        role: 'user',
        content: `Phase: ${phaseTitle}. Topic: ${topicName}. Write ${count} questions of realistic interview difficulty for this specific topic.`
      }
    ]
  });
  const parsed = JSON.parse(resp.choices[0].message.content);
  if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
    throw new Error('Model did not return usable questions');
  }
  return parsed.questions;
}

module.exports = { answerDoubt, generateAssessment };
