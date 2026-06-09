# ===== STRESS TEST RESULTS =====
# Testing Kira Learn as a difficult student
# Finding the WORST problems

## TEST 1: Confused student gives vague goal
USER: "idk i just want to make money"
EXPECT: AI should probe deeper, not accept this as a tool
ACTUAL PROBLEM: The goal extraction JSON parser will fail — no "tool" to extract.
FIX: Need fallback goal handling + smarter extraction

## TEST 2: Student gives one-word responses
USER: "ok" "cool" "yep" "sure"
EXPECT: AI should notice pattern and check if they're actually learning
ACTUAL PROBLEM: AI might just keep teaching without checking. The trigger system 
detects 3+ short answers but the AI might not act on it if the prompt doesn't
explicitly handle short-answer chains.
FIX: Add explicit short-answer handling in system prompt

## TEST 3: Student types nonsense/gibberish
USER: "asdfghjkl" or "???"
EXPECT: AI should respond with humor, not break
ACTUAL PROBLEM: Goal extraction will try to parse this as JSON and fail silently.
The conversation will continue with broken state.
FIX: Add input validation and gibberish detection

## TEST 4: Student gets angry/frustrated
USER: "this is stupid" "you suck" "shut up"
EXPECT: AI should de-escalate, not argue back
ACTUAL PROBLEM: No explicit handling for hostile inputs. AI might get defensive.
FIX: Add emotional de-escalation to system prompt

## TEST 5: Student asks completely off-topic
USER: "what's your favorite color" "are you real" "do you have feelings"
EXPECT: AI should acknowledge briefly and redirect to learning
ACTUAL PROBLEM: AI might give long philosophical answers (anti-yapping should catch 
some but the Socratic prompt doesn't handle off-topic)
FIX: Add off-topic handling to system prompt

## TEST 6: Student types very long paragraph
USER: 500-word essay about their life story
ACTUAL PROBLEM: maxOutputTokens 300 is fine, but the INPUT is huge, wasting tokens.
The system should handle long inputs gracefully.
FIX: Add input length guidance

## TEST 7: Student says they already know everything
USER: "i already know google ads, teach me something advanced"
ACTUAL PROBLEM: Goal discovery might not handle this. The teaching engine starts
at topic 0 regardless.
FIX: Add skill assessment phase

## TEST 8: Student wants to switch tools mid-conversation
USER: "actually i want to learn facebook ads instead"
ACTUAL PROBLEM: UserProfile.tool is set once and never updated. The entire
teaching engine sequence is based on the original tool.
FIX: Allow tool switching

## TEST 9: Student pastes error messages
USER: "Error: Campaign budget must be greater than 0"
ACTUAL PROBLEM: AI might try to debug the tool instead of teaching the concept.
FIX: Distinguish between "teach me" and "fix this for me"

## TEST 10: Empty input / just spaces
USER: "   "
ACTUAL PROBLEM: Should be caught by trim() check but worth verifying.

## TEST 11: Student types in another language
USER: "quiero aprender google ads" or "je veux apprendre figma"
ACTUAL PROBLEM: AI should respond in the same language but the prompt is in English.
FIX: Add multilingual awareness

## TEST 12: Student types extremely fast (within 1 second)
USER: Sends 5 messages in rapid succession
ACTUAL PROBLEM: Race conditions in conversation state. Messages might arrive 
out of order.
FIX: Add debouncing or queue

## CRITICAL DESIGN FLAWS FOUND:

1. **No input validation** — gibberish, empty, hostile inputs not handled
2. **Goal extraction is fragile** — JSON parsing can fail silently
3. **No graceful degradation** — if AI fails, user is stuck
4. **No onboarding recovery** — if user skips personality picker, they're in limbo
5. **Voice auto-speak on every message is ANNOYING** — should be opt-in
6. **No way to restart onboarding** — if something goes wrong
7. **Screen sharing without explanation confuses users** — need better UX
8. **The "wait" moment only works if AI detects specific patterns** — too narrow
9. **Mood detection is too simple** — just timing + keyword matching
10. **No error messages shown to user** — failures are silent
