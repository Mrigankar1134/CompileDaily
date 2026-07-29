// One-time (and re-runnable) seed of hand-written assessments. Resources are
// no longer seeded here — run `npm run import-resources` for the real 133-item
// catalogue (backend/data/java_career_resource_seed.json via import-resources.js).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Hand-written ("planned") assessments — one per phase to start. More can be
// generated on demand via Gemini from the app (source: 'ai').
const ASSESSMENTS = [
  { phase: 0, topic: null, title: 'Core Java Foundation — check yourself', questions: [
    { q: 'What does the HashMap load factor control?', options: ['The initial capacity only', 'When the map resizes based on how full it is', 'The maximum number of null keys allowed', 'The iteration order'], answerIndex: 1, explanation: 'Load factor is the threshold (fraction full) at which the map resizes and rehashes to keep lookups close to O(1).' },
    { q: 'Which keyword lets a subclass call its superclass constructor?', options: ['this', 'super', 'extends', 'implements'], answerIndex: 1, explanation: 'super(...) invokes the superclass constructor; it must be the first statement in the subclass constructor.' },
    { q: 'What happens if a checked exception is neither caught nor declared?', options: ['Compiles fine, fails at runtime', 'Compilation error', 'Silently ignored', 'Auto-converted to unchecked'], answerIndex: 1, explanation: 'Checked exceptions are enforced by the compiler — you must catch or declare (throws) them.' },
    { q: 'Which Stream operation below is a terminal operation?', options: ['map', 'filter', 'collect', 'peek'], answerIndex: 2, explanation: 'collect() triggers evaluation of the pipeline and produces a result; map/filter/peek are intermediate (lazy).' },
    { q: "What does 'volatile' guarantee for a field?", options: ['Atomic compound operations like i++', 'Visibility of writes across threads', 'Automatic locking', 'Thread scheduling priority'], answerIndex: 1, explanation: 'volatile ensures visibility (no stale cached reads) but does not make compound operations atomic.' }
  ]},
  { phase: 7, topic: null, title: 'Automation Engineering — check yourself', questions: [
    { q: 'Which wait should be preferred for predictable Selenium synchronization?', options: ['Thread.sleep', 'Implicit wait', 'Explicit wait with ExpectedConditions', "There's no need to wait"], answerIndex: 2, explanation: 'Explicit waits target a specific condition, are more reliable, and avoid mixing with implicit waits.' },
    { q: 'What is the main purpose of the Page Object Model?', options: ['Speed up test execution', 'Encapsulate page structure/actions for reuse and maintainability', 'Replace TestNG annotations', 'Avoid using locators entirely'], answerIndex: 1, explanation: 'POM isolates locators/actions per page so tests stay readable and changes are localized.' },
    { q: 'Which TestNG annotation runs once before the first test method in a class?', options: ['@BeforeMethod', '@BeforeClass', '@BeforeSuite', '@BeforeTest'], answerIndex: 1, explanation: '@BeforeClass runs once per class, before any @Test methods in it.' },
    { q: 'What lets a Cucumber scenario run with multiple data sets?', options: ['Background', 'Scenario Outline with Examples', 'Hooks', 'Tags'], answerIndex: 1, explanation: 'Scenario Outline + Examples table parameterizes a scenario across multiple rows of data.' },
    { q: 'Why use ThreadLocal for WebDriver in parallel runs?', options: ['To share one driver across threads', 'To give each thread its own isolated driver instance', 'To speed up page loads', "It's required by TestNG"], answerIndex: 1, explanation: 'ThreadLocal avoids race conditions by giving each parallel thread its own WebDriver instance.' }
  ]},
  { phase: 9, topic: null, title: 'API, Database & CI/CD — check yourself', questions: [
    { q: 'Which HTTP status code indicates successful resource creation?', options: ['200', '201', '204', '301'], answerIndex: 1, explanation: '201 Created is returned after a successful POST that creates a new resource.' },
    { q: 'What does "idempotent" mean for an HTTP method?', options: ['Always the same response body', 'Repeating it has the same effect as calling it once', 'It cannot be cached', 'It requires authentication'], answerIndex: 1, explanation: 'GET, PUT and DELETE are designed so repeated calls leave the system in the same state as one call.' },
    { q: 'In REST Assured, how do you pull a value out of the JSON response for assertions?', options: ['given()', 'jsonPath() / extract().path()', 'when()', 'post()'], answerIndex: 1, explanation: 'jsonPath() or extract().path("field") reads values from the response body for further assertions.' },
    { q: "A transaction's isolation level is primarily concerned with:", options: ['Storage size', 'How concurrent transactions see uncommitted changes', 'Index creation', 'Query syntax'], answerIndex: 1, explanation: 'Isolation levels (Read Committed, Repeatable Read, Serializable, etc.) control visibility of concurrent changes.' },
    { q: 'What is WireMock used for?', options: ['Running production APIs faster', 'Stubbing/mocking HTTP services to isolate tests', 'Replacing TestNG', 'Generating Java code'], answerIndex: 1, explanation: 'WireMock stands in for real dependencies so tests are fast and deterministic.' }
  ]},
  { phase: 2, topic: null, title: 'Spring Boot Backend — check yourself', questions: [
    { q: 'Which annotation marks a Spring bean that returns JSON directly (not a view name)?', options: ['@Controller', '@RestController', '@Service', '@Component'], answerIndex: 1, explanation: '@RestController = @Controller + @ResponseBody, so return values are serialized straight to the response body.' },
    { q: 'Why prefer constructor injection over field injection?', options: ["It's the only option that compiles", 'Easier testing, immutability, explicit required dependencies', "It's faster at runtime", 'It disables autowiring'], answerIndex: 1, explanation: 'Constructor injection makes dependencies explicit and required, and is easy to instantiate in unit tests without reflection.' },
    { q: 'What does @Transactional primarily manage?', options: ['HTTP session state', 'Database transaction boundaries (commit/rollback)', 'Bean scope', 'Serialization'], answerIndex: 1, explanation: 'It wraps the method in a transaction, rolling back on unchecked exceptions by default.' },
    { q: 'Extending JpaRepository gives you, out of the box:', options: ['Custom business logic', 'Basic CRUD and pagination methods', 'Automatic REST endpoints', 'Security filters'], answerIndex: 1, explanation: 'Spring Data JPA generates CRUD, sorting and pagination methods without extra code.' },
    { q: 'A key reason to use DTOs instead of returning JPA entities from controllers:', options: ['DTOs instantiate faster', 'Avoids exposing internal persistence structure and lazy-loading issues', "Entities can't be serialized at all", 'Spring Boot requires it'], answerIndex: 1, explanation: 'DTOs define a stable API contract independent of the entity/persistence model.' }
  ]},
  { phase: 26, topic: null, title: 'Security & Production Readiness — check yourself', questions: [
    { q: 'What does JWT stand for?', options: ['Java Web Token', 'JSON Web Token', 'Just Web Trust', 'Joint Web Testing'], answerIndex: 1, explanation: 'A JWT is a compact, signed token carrying claims, commonly used for stateless authentication.' },
    { q: 'Where is a JWT usually sent on subsequent authenticated requests?', options: ['As a URL query parameter', 'In the Authorization: Bearer header', 'In a hidden form field', "It isn't resent"], answerIndex: 1, explanation: 'The standard convention is an Authorization: Bearer <token> request header.' },
    { q: 'What is Testcontainers used for?', options: ['Mocking all dependencies with fakes', 'Running real dependencies (e.g. Postgres) in disposable Docker containers for tests', 'Replacing JUnit', 'Only UI testing'], answerIndex: 1, explanation: 'It spins up real services in containers so integration tests run against the real thing.' },
    { q: 'Authentication vs authorization:', options: ['They are the same thing', 'Authentication verifies identity; authorization checks permissions', 'Authorization always happens first', 'Only authorization needs a database'], answerIndex: 1, explanation: 'Authentication answers "who are you"; authorization answers "what are you allowed to do".' },
    { q: 'What does MockMvc let you test without a running HTTP server?', options: ['Database migrations', 'Spring MVC controller request/response behavior in-process', 'Frontend JavaScript', 'Docker containers'], answerIndex: 1, explanation: 'MockMvc simulates the Spring MVC dispatch process without binding a real port.' }
  ]},
  { phase: 43, topic: null, title: 'Interview & Applications — check yourself', questions: [
    { q: 'What is the STAR format for?', options: ['A coding style guide', 'Structuring answers to behavioral questions (Situation, Task, Action, Result)', 'A Java design pattern', 'A Selenium locator strategy'], answerIndex: 1, explanation: 'STAR gives a clear, complete structure for experience-based interview answers.' },
    { q: 'The two-pointer technique is most useful for:', options: ['Sorting file names', 'Array/string problems needing pairs or a moving window', 'Database indexing', 'REST API design'], answerIndex: 1, explanation: "It's a classic pattern for problems like pair-sum, reversing, or sliding-window scans in O(n)." },
    { q: 'Why keep separate resumes for SDET vs backend-developer roles?', options: ["It's legally required", 'Each highlights the most relevant stack/experience for that specific role', 'Recruiters prefer longer resumes', "One resume can't mention Java"], answerIndex: 1, explanation: 'Tailoring emphasis (automation vs backend) improves relevance for each application.' },
    { q: 'A strong project architecture explanation should cover:', options: ['Only the language used', 'The problem, key design decisions, trade-offs and how components interact', 'Just the GitHub star count', "The README's color scheme"], answerIndex: 1, explanation: 'Interviewers want to see reasoning and trade-offs, not just a feature list.' },
    { q: 'A good habit while job hunting is to:', options: ['Never follow up after applying', 'Log company, date, role and status, and follow up periodically', 'Apply to only one role total', 'Avoid applying broadly'], answerIndex: 1, explanation: 'Tracking applications keeps follow-ups timely and shows patterns in what is/isn’t working.' }
  ]}
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("delete from assessments where source = 'planned'");
    for (const a of ASSESSMENTS) {
      await client.query(
        `insert into assessments (phase_index, topic_index, title, source, questions)
         values ($1,$2,$3,'planned',$4::jsonb)`,
        [a.phase, a.topic, a.title, JSON.stringify(a.questions)]
      );
    }
    await client.query('commit');
    console.log(`Seeded ${ASSESSMENTS.length} assessments. (Run "npm run import-resources" for the resource catalogue.)`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });
