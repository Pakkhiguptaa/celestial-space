/**
 * GoNoGo — AI Market Research & Decision Agent
 * Multi-step agent workflow: Interpret → Demand → Competitors → Pain Points → Geography → Revenue → Decision
 */

// ==================== API KEYS (hardcoded) ====================
const KEYS = {
  tavily: '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',
  llm:    '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',
};

// ==================== STATE ====================
const STATE = {
  keys: KEYS,
  idea: '',
  results: {},
  running: false,
};

// ==================== DOM REFS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  ideaInput: $('#idea-input'),
  charCount: $('#char-count'),
  runBtn: $('#run-btn'),
  btnText: $('.btn-text'),
  btnLoader: $('.btn-loader'),
  pipelineSection: $('#pipeline-section'),
  resultsSection: $('#results-section'),
  scoreCircle: $('#score-circle'),
  scoreValue: $('#score-value'),
  verdictBadge: $('#verdict-badge'),
  verdictSummary: $('#verdict-summary'),
  logPanel: $('#log-panel'),
  logBody: $('#log-body'),
  toggleLog: $('#toggle-log'),
  exportJsonBtn: $('#export-json-btn'),
  newAnalysisBtn: $('#new-analysis-btn'),
};

// ==================== INIT ====================
function init() {
  bindEvents();
}

function bindEvents() {
  DOM.ideaInput.addEventListener('input', () => {
    const len = DOM.ideaInput.value.length;
    DOM.charCount.textContent = len;
    DOM.runBtn.disabled = len < 10;
  });
  DOM.runBtn.addEventListener('click', () => runAnalysis());
  DOM.toggleLog.addEventListener('click', () => {
    DOM.logPanel.classList.toggle('collapsed');
  });
  DOM.exportJsonBtn.addEventListener('click', exportJSON);
  DOM.newAnalysisBtn.addEventListener('click', resetUI);
}

// ==================== LOGGING ====================
function log(step, msg, level = 'info') {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry${level === 'error' ? ' log-error' : level === 'success' ? ' log-success' : ''}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-step">[${step}]</span> <span class="log-msg">${msg}</span>`;
  DOM.logBody.appendChild(entry);
  DOM.logBody.scrollTop = DOM.logBody.scrollHeight;
}

// ==================== PIPELINE UI ====================
function setPipeStep(stepName, status) {
  const el = $(`.pipe-step[data-step="${stepName}"]`);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  if (status === 'active') {
    el.classList.add('active');
    el.querySelector('.pipe-status').textContent = 'Running...';
  } else if (status === 'done') {
    el.classList.add('done');
    el.querySelector('.pipe-status').textContent = 'Complete';
  } else if (status === 'error') {
    el.classList.add('error');
    el.querySelector('.pipe-status').textContent = 'Failed';
  }
}

function setLoading(loading) {
  STATE.running = loading;
  DOM.runBtn.disabled = loading;
  if (loading) {
    DOM.btnText.classList.add('hidden');
    DOM.btnLoader.classList.remove('hidden');
  } else {
    DOM.btnText.classList.remove('hidden');
    DOM.btnLoader.classList.add('hidden');
  }
}

// ==================== API HELPERS ====================

/**
 * Call GitHub Models GPT-4o
 */
async function callLLM(systemPrompt, userPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${STATE.keys.llm}`,
      'HTTP-Referer': 'https://github.com/Pakkhiguptaa/celestial-space',
      'X-Title': 'GoNoGo Agent',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

/**
 * Call LLM without JSON mode (for free-form text)
 */
async function callLLMText(systemPrompt, userPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${STATE.keys.llm}`,
      'HTTP-Referer': 'https://github.com/Pakkhiguptaa/celestial-space',
      'X-Title': 'GoNoGo Agent',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) throw new Error(`LLM API error ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Call Tavily Search API
 */
async function callTavily(query, options = {}) {
  const body = {
    query,
    api_key: STATE.keys.tavily,
    search_depth: options.depth || 'advanced',
    include_answer: true,
    max_results: options.maxResults || 5,
    ...(options.domains ? { include_domains: options.domains } : {}),
  };
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${err}`);
  }
  return res.json();
}



// ==================== PIPELINE STEPS ====================

/**
 * Step 1: Idea Interpretation — uses LLM to extract structured data from the raw idea.
 */
async function stepInterpret(idea) {
  setPipeStep('interpret', 'active');
  log('Interpret', 'Parsing business idea with LLM...');

  const systemPrompt = `You are a business analyst. Extract structured information from a business idea description.
Return JSON with exactly these fields:
{
  "target_customer": "string — who is the primary customer",
  "problem_being_solved": "string — what problem does this solve",
  "business_model": "string — how does it make money (subscription, marketplace, SaaS, etc.)",
  "industry": "string — primary industry category",
  "keywords": ["array", "of", "search", "keywords", "for", "market", "research"],
  "one_liner": "string — a concise one-liner description of the business"
}
Be specific and practical. Extract at least 5 diverse keywords useful for market research.`;

  const result = await callLLM(systemPrompt, `Business idea: ${idea}`);
  STATE.results.interpret = result;

  log('Interpret', `Found: ${result.target_customer} | ${result.business_model}`, 'success');
  setPipeStep('interpret', 'done');
  return result;
}

/**
 * Step 2: Demand & Trend Analysis — uses SerpApi to check volume and trends.
 */
async function stepDemand(interpreted) {
  setPipeStep('demand', 'active');

  const keywords = interpreted.keywords.slice(0, 4);
  let searchData = [];
  let trendData = { direction: 'unknown', note: 'Using Tavily for demand estimation' };

  log('Demand', 'Analyzing search demand via Tavily...');
  // Use Tavily to gather demand signals
  try {
    const tavResult = await callTavily(`${interpreted.keywords[0]} market demand growth trends ${new Date().getFullYear()}`, { maxResults: 8 });
    searchData = (tavResult.results || []).map(r => ({ 
      keyword: interpreted.keywords[0], 
      title: r.title,
      snippet: r.content?.substring(0, 300) 
    }));
    if (tavResult.answer) {
      searchData.push({ keyword: 'summary', snippet: tavResult.answer });
    }
    log('Demand', `Gathered ${searchData.length} demand signals via Tavily`, 'success');
  } catch (e) {
    log('Demand', `Demand search failed: ${e.message}`, 'error');
  }


  // Use LLM to synthesize demand analysis
  const systemPrompt = `You are a market research analyst. Given search data and trend data for a business idea, determine demand level and trend direction.
Return JSON:
{
  "demand_level": "low" | "medium" | "high",
  "trend_direction": "rising" | "stable" | "declining",
  "search_volume_indicator": "string — brief explanation of volume signals",
  "related_queries": ["top", "5", "related", "queries"],
  "reasoning": "string — 2-3 sentences explaining the demand assessment"
}`;

  const userPrompt = `Business: ${interpreted.one_liner}
Search Data: ${JSON.stringify(searchData)}
Trend Data: ${JSON.stringify(trendData)}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.demand = result;

  log('Demand', `Demand: ${result.demand_level} | Trend: ${result.trend_direction}`, 'success');
  setPipeStep('demand', 'done');
  return result;
}

/**
 * Step 3: Competitor Discovery — uses Tavily to find and analyze competitors.
 */
async function stepCompetitors(interpreted) {
  setPipeStep('competitors', 'active');
  log('Competitors', 'Discovering competitors via Tavily...');

  const queries = [
    `best ${interpreted.keywords[0]} companies`,
    `${interpreted.industry} startups competitors ${interpreted.keywords[1] || ''}`,
    `alternatives to ${interpreted.one_liner}`,
  ];

  let searchResults = [];
  for (const q of queries) {
    try {
      log('Competitors', `Searching: "${q}"`);
      const tavResult = await callTavily(q, { maxResults: 5 });
      searchResults.push(...(tavResult.results || []));
    } catch (e) {
      log('Competitors', `Tavily search failed: ${e.message}`, 'error');
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  searchResults = searchResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const systemPrompt = `You are a competitive intelligence analyst. Given search results about competitors for a business idea, extract a structured competitor analysis.
Return JSON:
{
  "competitors": [
    {
      "name": "Company Name",
      "url": "https://...",
      "description": "What they do in 1 sentence",
      "pricing_model": "free / freemium / paid / subscription / unknown",
      "target_audience": "Who they target",
      "positioning": "Their key differentiator in 1 sentence"
    }
  ],
  "market_saturation": "low" | "medium" | "high",
  "competitive_gaps": ["gap 1", "gap 2"],
  "reasoning": "2-3 sentences on the competitive landscape"
}
List up to 6 competitors. Be factual — only include companies you can identify from the search results.`;

  const userPrompt = `Business idea: ${interpreted.one_liner}
Industry: ${interpreted.industry}
Search results: ${JSON.stringify(searchResults.slice(0, 12).map(r => ({ title: r.title, url: r.url, content: r.content?.substring(0, 300) })))}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.competitors = result;

  log('Competitors', `Found ${result.competitors?.length || 0} competitors | Saturation: ${result.market_saturation}`, 'success');
  setPipeStep('competitors', 'done');
  return result;
}

/**
 * Step 4: Pain Point Detection — uses Tavily to find user complaints and frustrations.
 */
async function stepPainPoints(interpreted) {
  setPipeStep('painpoints', 'active');
  log('Pain Points', 'Detecting user pain points via Tavily...');

  const queries = [
    `${interpreted.keywords[0]} complaints problems`,
    `${interpreted.industry} user frustrations reviews`,
    `"I hate" OR "I wish" OR "biggest problem" ${interpreted.keywords[0]}`,
  ];

  let searchResults = [];
  for (const q of queries) {
    try {
      log('Pain Points', `Searching: "${q}"`);
      const tavResult = await callTavily(q, {
        maxResults: 5,
        domains: ['reddit.com', 'quora.com', 'trustpilot.com', 'g2.com'],
      });
      searchResults.push(...(tavResult.results || []));
      if (tavResult.answer) {
        searchResults.push({ title: 'Tavily Summary', content: tavResult.answer, url: '' });
      }
    } catch (e) {
      log('Pain Points', `Search failed: ${e.message}`, 'error');
    }
  }

  const systemPrompt = `You are a user research analyst. Given search results about user complaints and frustrations in a specific market, extract pain points.
Return JSON:
{
  "pain_points": [
    {
      "issue": "Brief description of the pain point",
      "frequency": "high" | "medium" | "low",
      "source_type": "reviews / forums / social media / articles"
    }
  ],
  "overall_pain_severity": "low" | "medium" | "high",
  "opportunity_signal": "string — what this means for the business opportunity",
  "reasoning": "2-3 sentences"
}
List 3-6 pain points. Be factual — only report pain points supported by the search data.`;

  const userPrompt = `Business idea: ${interpreted.one_liner}
Target customer: ${interpreted.target_customer}
Problem being solved: ${interpreted.problem_being_solved}
Search results: ${JSON.stringify(searchResults.slice(0, 10).map(r => ({ title: r.title, content: r.content?.substring(0, 400) })))}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.painpoints = result;

  log('Pain Points', `Found ${result.pain_points?.length || 0} pain points | Severity: ${result.overall_pain_severity}`, 'success');
  setPipeStep('painpoints', 'done');
  return result;
}

/**
 * Step 5: Geography Analysis — uses trend + search signals to identify best regions.
 */
async function stepGeography(interpreted, demandData) {
  setPipeStep('geography', 'active');
  log('Geography', 'Analyzing geographic demand via Tavily...');

  let geoSearch = [];
  try {
    const tavResult = await callTavily(`${interpreted.keywords[0]} regional market demand by country ${new Date().getFullYear()}`, { maxResults: 8 });
    geoSearch = (tavResult.results || []).map(r => ({
      title: r.title,
      content: r.content?.substring(0, 400)
    }));
    if (tavResult.answer) {
      geoSearch.push({ title: 'Geography Summary', content: tavResult.answer });
    }
    log('Geography', `Gathered ${geoSearch.length} geographic signals`, 'success');
  } catch (e) {
    log('Geography', `Geography search failed: ${e.message}`, 'error');
  }


  const systemPrompt = `You are a market geography analyst. Given trend data and search results about geographic demand for a business concept, identify the top 3 regions/countries for market entry.
Return JSON:
{
  "top_regions": [
    {
      "rank": 1,
      "region": "Country or region name",
      "reasoning": "Why this region ranks here — 1-2 sentences",
      "demand_signal": "high" | "medium" | "low"
    }
  ],
  "geographic_strategy": "string — 2-3 sentences on recommended geographic approach",
  "data_confidence": "low" | "medium" | "high"
}
Be specific. If data is limited, say so and use logical inference.`;

  const userPrompt = `Business: ${interpreted.one_liner}
Industry: ${interpreted.industry}
Target customer: ${interpreted.target_customer}
Demand data: ${JSON.stringify(demandData)}
Geographic search results: ${JSON.stringify(geoSearch)}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.geography = result;

  log('Geography', `Top region: ${result.top_regions?.[0]?.region || 'N/A'}`, 'success');
  setPipeStep('geography', 'done');
  return result;
}

/**
 * Step 6: Revenue Estimation — uses all prior data to estimate revenue potential.
 */
async function stepRevenue(interpreted, demandData, competitorData) {
  setPipeStep('revenue', 'active');
  log('Revenue', 'Estimating revenue potential...');

  // Search for market size data
  let marketData = [];
  try {
    const tavResult = await callTavily(`${interpreted.industry} market size revenue TAM ${new Date().getFullYear()}`, { maxResults: 5 });
    marketData = tavResult.results || [];
  } catch (e) {
    log('Revenue', `Market size search failed: ${e.message}`, 'error');
  }

  const systemPrompt = `You are a financial analyst specializing in market sizing and revenue estimation for new ventures.
Given data about demand, competitors, and market size, estimate revenue potential for a new business.
Return JSON:
{
  "revenue_estimate": {
    "low": "$XX,XXX/year — conservative estimate",
    "base": "$XX,XXX/year — realistic estimate",
    "high": "$XX,XXX/year — optimistic estimate"
  },
  "revenue_numbers": {
    "low": 50000,
    "base": 200000,
    "high": 500000
  },
  "target_market_size": "string — estimated addressable market",
  "pricing_assumption": "string — assumed pricing model and price point",
  "customer_acquisition": "string — assumed acquisition rate",
  "assumptions": [
    "Assumption 1",
    "Assumption 2",
    "Assumption 3"
  ],
  "reasoning": "2-3 sentences on the revenue logic"
}
Be realistic. Show your assumptions clearly. Use competitor pricing as benchmarks when available.`;

  const userPrompt = `Business: ${interpreted.one_liner}
Business model: ${interpreted.business_model}
Demand level: ${demandData.demand_level}
Competitors: ${JSON.stringify(competitorData.competitors?.slice(0, 4).map(c => ({ name: c.name, pricing: c.pricing_model })))}
Market saturation: ${competitorData.market_saturation}
Market data: ${JSON.stringify(marketData.slice(0, 5).map(r => ({ title: r.title, content: r.content?.substring(0, 300) })))}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.revenue = result;

  log('Revenue', `Base estimate: ${result.revenue_estimate?.base || 'N/A'}`, 'success');
  setPipeStep('revenue', 'done');
  return result;
}

/**
 * Step 7: Final Decision Engine — combines all signals into a verdict.
 */
async function stepDecision(interpreted, demandData, competitorData, painPointData, geoData, revenueData) {
  setPipeStep('decision', 'active');
  log('Decision', 'Running final decision engine...');

  const systemPrompt = `You are a senior business strategist making a Go / Test / No-Go decision for a new business venture.
Combine ALL the research signals provided to produce a final, actionable verdict.

Scoring guidance:
- 0-30: No-Go — fundamental issues, low demand, high saturation, weak revenue
- 31-60: Test — promising signals but significant uncertainties remain
- 61-100: Go — strong demand, clear opportunity, viable revenue

Return JSON:
{
  "viability_score": 72,
  "decision": "Go" | "Test" | "No-Go",
  "decision_summary": "2-3 sentence summary of the verdict",
  "key_strengths": ["strength 1", "strength 2", "strength 3"],
  "key_risks": [
    {"risk": "description", "severity": "high" | "medium" | "low"}
  ],
  "next_steps": [
    "Specific actionable step 1",
    "Specific actionable step 2",
    "Specific actionable step 3",
    "Specific actionable step 4"
  ],
  "score_breakdown": {
    "demand": 0-25,
    "competition": 0-25,
    "pain_points": 0-25,
    "revenue_potential": 0-25
  }
}
Be decisive but honest. Prioritize usefulness over optimism.`;

  const userPrompt = `BUSINESS IDEA: ${interpreted.one_liner}
TARGET CUSTOMER: ${interpreted.target_customer}
PROBLEM: ${interpreted.problem_being_solved}
BUSINESS MODEL: ${interpreted.business_model}

DEMAND: Level=${demandData.demand_level}, Trend=${demandData.trend_direction}, ${demandData.reasoning}
COMPETITION: Saturation=${competitorData.market_saturation}, ${competitorData.competitors?.length || 0} competitors found, Gaps: ${JSON.stringify(competitorData.competitive_gaps)}
PAIN POINTS: Severity=${painPointData.overall_pain_severity}, ${painPointData.pain_points?.length || 0} issues found, ${painPointData.opportunity_signal}
GEOGRAPHY: Top region=${geoData.top_regions?.[0]?.region}, Strategy: ${geoData.geographic_strategy}
REVENUE: Base=${revenueData.revenue_estimate?.base}, Range: ${revenueData.revenue_estimate?.low} to ${revenueData.revenue_estimate?.high}`;

  const result = await callLLM(systemPrompt, userPrompt);
  STATE.results.decision = result;

  log('Decision', `VERDICT: ${result.decision} (Score: ${result.viability_score}/100)`, 'success');
  setPipeStep('decision', 'done');
  return result;
}

// ==================== MAIN ORCHESTRATOR ====================
async function runAnalysis() {
  if (STATE.running) return;

  const idea = DOM.ideaInput.value.trim();
  if (idea.length < 10) return;

  STATE.idea = idea;
  STATE.results = {};
  setLoading(true);

  // Show pipeline, hide results
  DOM.pipelineSection.classList.remove('hidden');
  DOM.resultsSection.classList.add('hidden');
  DOM.logPanel.classList.remove('hidden');
  DOM.logBody.innerHTML = '';

  // Reset pipeline steps
  $$('.pipe-step').forEach(el => {
    el.classList.remove('active', 'done', 'error');
    el.querySelector('.pipe-status').textContent = 'Waiting';
  });

  log('Agent', `Starting analysis for: "${idea.substring(0, 80)}..."`, 'info');

  try {
    // Step 1: Interpret
    const interpreted = await stepInterpret(idea);

    // Step 2: Demand (depends on Step 1 for keywords)
    const demandData = await stepDemand(interpreted);

    // Step 3 & 4: Competitors and Pain Points (can run in parallel)
    const [competitorData, painPointData] = await Promise.all([
      stepCompetitors(interpreted),
      stepPainPoints(interpreted),
    ]);

    // Step 5: Geography (depends on demand data)
    const geoData = await stepGeography(interpreted, demandData);

    // Step 6: Revenue (depends on demand + competitors)
    const revenueData = await stepRevenue(interpreted, demandData, competitorData);

    // Step 7: Final Decision (depends on everything)
    const decisionData = await stepDecision(interpreted, demandData, competitorData, painPointData, geoData, revenueData);

    // Render results
    log('Agent', 'Analysis complete! Rendering results...', 'success');
    renderResults();

  } catch (err) {
    log('Agent', `Fatal error: ${err.message}`, 'error');
    console.error(err);
    alert(`Analysis failed: ${err.message}\n\nCheck the Agent Log for details.`);
  } finally {
    setLoading(false);
  }
}

// ==================== RENDER RESULTS ====================
function renderResults() {
  const { interpret, demand, competitors, painpoints, geography, revenue, decision } = STATE.results;

  // Show results section
  DOM.resultsSection.classList.remove('hidden');
  DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Decision banner
  if (decision) {
    // Animate score
    const score = decision.viability_score || 0;
    const circumference = 339.3;
    const offset = circumference - (circumference * score / 100);
    DOM.scoreCircle.style.strokeDashoffset = offset;
    animateNumber(DOM.scoreValue, 0, score, 1200);

    // Verdict badge
    const d = decision.decision?.toLowerCase().replace('-', '');
    DOM.verdictBadge.textContent = decision.decision;
    DOM.verdictBadge.className = 'verdict-badge';
    if (d === 'go') DOM.verdictBadge.classList.add('go');
    else if (d === 'test') DOM.verdictBadge.classList.add('test');
    else DOM.verdictBadge.classList.add('nogo');

    DOM.verdictSummary.textContent = decision.decision_summary || '';

    // Update score gradient color based on verdict
    const gradStop0 = $('#score-grad stop:first-child');
    const gradStop1 = $('#score-grad stop:last-child');
    if (d === 'go') {
      gradStop0.setAttribute('stop-color', '#00F5A0');
      gradStop1.setAttribute('stop-color', '#00D9F5');
    } else if (d === 'test') {
      gradStop0.setAttribute('stop-color', '#FFC107');
      gradStop1.setAttribute('stop-color', '#FF6B35');
    } else {
      gradStop0.setAttribute('stop-color', '#FF4757');
      gradStop1.setAttribute('stop-color', '#FF6B81');
    }
  }

  // Card: Interpret
  if (interpret) {
    $('#body-interpret').innerHTML = `
      <div class="data-row"><span class="data-label">Target Customer</span><span class="data-value">${esc(interpret.target_customer)}</span></div>
      <div class="data-row"><span class="data-label">Problem</span><span class="data-value">${esc(interpret.problem_being_solved)}</span></div>
      <div class="data-row"><span class="data-label">Business Model</span><span class="data-value">${esc(interpret.business_model)}</span></div>
      <div class="data-row"><span class="data-label">Industry</span><span class="data-value">${esc(interpret.industry)}</span></div>
      <div class="data-row"><span class="data-label">Keywords</span><span class="data-value">${(interpret.keywords || []).map(k => `<span class="tag tag-rising">${esc(k)}</span>`).join(' ')}</span></div>
    `;
  }

  // Card: Demand
  if (demand) {
    const demandTag = demand.demand_level === 'high' ? 'tag-high' : demand.demand_level === 'medium' ? 'tag-medium' : 'tag-low';
    const trendTag = demand.trend_direction === 'rising' ? 'tag-rising' : demand.trend_direction === 'stable' ? 'tag-stable' : 'tag-declining';
    $('#body-demand').innerHTML = `
      <div class="data-row"><span class="data-label">Demand Level</span><span class="tag ${demandTag}">${esc(demand.demand_level)}</span></div>
      <div class="data-row"><span class="data-label">Trend Direction</span><span class="tag ${trendTag}">${esc(demand.trend_direction)}</span></div>
      <div class="data-row"><span class="data-label">Volume Signal</span><span class="data-value">${esc(demand.search_volume_indicator)}</span></div>
      <p style="margin-top:12px;">${esc(demand.reasoning)}</p>
      ${demand.related_queries?.length ? `<div style="margin-top:12px;"><span class="data-label">Related Queries</span><div style="margin-top:6px;">${demand.related_queries.map(q => `<span class="tag tag-rising" style="margin:2px;">${esc(q)}</span>`).join('')}</div></div>` : ''}
    `;
  }

  // Card: Competitors
  if (competitors) {
    const satTag = competitors.market_saturation === 'high' ? 'tag-low' : competitors.market_saturation === 'medium' ? 'tag-medium' : 'tag-high';
    let html = `<div class="data-row"><span class="data-label">Market Saturation</span><span class="tag ${satTag}">${esc(competitors.market_saturation)}</span></div>`;
    (competitors.competitors || []).forEach(c => {
      html += `<div class="competitor-item">
        <div class="competitor-name">${esc(c.name)}</div>
        <div class="competitor-detail">${esc(c.description || '')} | Pricing: ${esc(c.pricing_model || 'unknown')} | Target: ${esc(c.target_audience || 'N/A')}</div>
      </div>`;
    });
    if (competitors.competitive_gaps?.length) {
      html += `<div style="margin-top:12px;"><span class="data-label">Competitive Gaps</span><ul>${competitors.competitive_gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>`;
    }
    html += `<p style="margin-top:12px;">${esc(competitors.reasoning || '')}</p>`;
    $('#body-competitors').innerHTML = html;
  }

  // Card: Pain Points
  if (painpoints) {
    const sevTag = painpoints.overall_pain_severity === 'high' ? 'tag-high' : painpoints.overall_pain_severity === 'medium' ? 'tag-medium' : 'tag-low';
    let html = `<div class="data-row"><span class="data-label">Pain Severity</span><span class="tag ${sevTag}">${esc(painpoints.overall_pain_severity)}</span></div>`;
    (painpoints.pain_points || []).forEach(pp => {
      const freqTag = pp.frequency === 'high' ? 'tag-high' : pp.frequency === 'medium' ? 'tag-medium' : 'tag-low';
      html += `<div class="data-row">
        <span class="data-value" style="flex:1;">${esc(pp.issue)}</span>
        <span class="tag ${freqTag}" style="margin-left:8px;">${esc(pp.frequency)}</span>
      </div>`;
    });
    html += `<p style="margin-top:12px;"><strong>Opportunity:</strong> ${esc(painpoints.opportunity_signal || '')}</p>`;
    $('#body-painpoints').innerHTML = html;
  }

  // Card: Geography
  if (geography) {
    let html = '';
    (geography.top_regions || []).forEach(r => {
      html += `<div class="geo-rank">
        <div class="geo-number">${r.rank}</div>
        <div class="geo-info">
          <div class="geo-name">${esc(r.region)}</div>
          <div class="geo-reason">${esc(r.reasoning)}</div>
        </div>
        <span class="tag ${r.demand_signal === 'high' ? 'tag-high' : r.demand_signal === 'medium' ? 'tag-medium' : 'tag-low'}">${esc(r.demand_signal)}</span>
      </div>`;
    });
    html += `<p style="margin-top:12px;">${esc(geography.geographic_strategy || '')}</p>`;
    html += `<div class="data-row" style="margin-top:8px;"><span class="data-label">Data Confidence</span><span class="tag ${geography.data_confidence === 'high' ? 'tag-high' : geography.data_confidence === 'medium' ? 'tag-medium' : 'tag-low'}">${esc(geography.data_confidence || 'N/A')}</span></div>`;
    $('#body-geography').innerHTML = html;
  }

  // Card: Revenue
  if (revenue) {
    const nums = revenue.revenue_numbers || { low: 50000, base: 200000, high: 500000 };
    const maxRev = nums.high || 500000;
    let html = `
      <div class="revenue-bar">
        <span class="revenue-label">Low</span>
        <div class="revenue-track"><div class="revenue-fill low" style="width: ${(nums.low / maxRev * 100)}%"></div></div>
        <span class="revenue-amount">${esc(revenue.revenue_estimate?.low || '')}</span>
      </div>
      <div class="revenue-bar">
        <span class="revenue-label">Base</span>
        <div class="revenue-track"><div class="revenue-fill base" style="width: ${(nums.base / maxRev * 100)}%"></div></div>
        <span class="revenue-amount">${esc(revenue.revenue_estimate?.base || '')}</span>
      </div>
      <div class="revenue-bar">
        <span class="revenue-label">High</span>
        <div class="revenue-track"><div class="revenue-fill high" style="width: 100%"></div></div>
        <span class="revenue-amount">${esc(revenue.revenue_estimate?.high || '')}</span>
      </div>
      <div class="data-row" style="margin-top:12px;"><span class="data-label">Market Size</span><span class="data-value">${esc(revenue.target_market_size || '')}</span></div>
      <div class="data-row"><span class="data-label">Pricing</span><span class="data-value">${esc(revenue.pricing_assumption || '')}</span></div>
    `;
    if (revenue.assumptions?.length) {
      html += `<div class="assumptions-section"><div class="assumptions-title">Key Assumptions</div><ul>${revenue.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
    }
    $('#body-revenue').innerHTML = html;
  }

  // Card: Risks & Next Steps
  if (decision) {
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">';

    // Risks
    html += '<div>';
    html += '<div class="assumptions-title" style="margin-bottom:8px;">Key Risks</div>';
    (decision.key_risks || []).forEach(r => {
      const sevTag = r.severity === 'high' ? 'tag-low' : r.severity === 'medium' ? 'tag-medium' : 'tag-high';
      html += `<div class="risk-item">
        <span class="risk-icon">⚠</span>
        <span style="flex:1;">${esc(r.risk)}</span>
        <span class="tag ${sevTag}">${esc(r.severity)}</span>
      </div>`;
    });
    html += '</div>';

    // Next Steps
    html += '<div>';
    html += '<div class="assumptions-title" style="margin-bottom:8px;">Next Steps</div>';
    (decision.next_steps || []).forEach((step, i) => {
      html += `<div class="next-step-item">
        <span class="next-step-icon">→</span>
        <span>${esc(step)}</span>
      </div>`;
    });
    html += '</div>';

    html += '</div>';

    // Score breakdown
    if (decision.score_breakdown) {
      const sb = decision.score_breakdown;
      html += `<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-subtle);">
        <div class="assumptions-title" style="margin-bottom:12px;">Score Breakdown (out of 25 each)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center;">
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent-go);font-family:'JetBrains Mono',monospace;">${sb.demand || 0}</div><div class="data-label">Demand</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent-purple);font-family:'JetBrains Mono',monospace;">${sb.competition || 0}</div><div class="data-label">Competition</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent-cyan);font-family:'JetBrains Mono',monospace;">${sb.pain_points || 0}</div><div class="data-label">Pain Points</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent-test);font-family:'JetBrains Mono',monospace;">${sb.revenue_potential || 0}</div><div class="data-label">Revenue</div></div>
        </div>
      </div>`;
    }

    // Strengths
    if (decision.key_strengths?.length) {
      html += `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle);">
        <div class="assumptions-title" style="margin-bottom:8px;">Key Strengths</div>
        <ul>${decision.key_strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>`;
    }

    $('#body-risks').innerHTML = html;
  }
}

// ==================== UTILITIES ====================
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function exportJSON() {
  const data = {
    idea: STATE.idea,
    timestamp: new Date().toISOString(),
    results: STATE.results,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gonogo_report_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function resetUI() {
  DOM.resultsSection.classList.add('hidden');
  DOM.pipelineSection.classList.add('hidden');
  DOM.logPanel.classList.add('hidden');
  DOM.ideaInput.value = '';
  DOM.charCount.textContent = '0';
  DOM.runBtn.disabled = true;
  STATE.results = {};
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== BOOT ====================
document.addEventListener('DOMContentLoaded', init);
