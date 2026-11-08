# Demo video: script v4 (target 2:40, 16:9)

> **Status: draft for the team to review.** This is the main demo, submitted on sinceai.app (Sunday 10:00). The narration is written for Elisa's reviewers: telecom experts, in short clear sentences. Lines marked **[confirm]** need a check against the real app before the voice is recorded.

**One message:** the knowledge that fixes the network is hidden in everyday conversations. ElidEx finds it, ties it to the network and hands it to agents, without asking anyone to write anything. And it keeps learning, all day long.

**Shape of the story:**

1. Two colleagues solve a problem in a chat.
2. The real knowledge in it was never written down.
3. **Capture → Link → Reuse**: the same three words as the deck, shown as chapter marks. A ball of light carries the knowledge from the chat into the graph, and later back to the agent.
4. It doesn't stop there: ElidEx connects problems nobody connected.
5. It ends where it started: a network that remembers. (The Company day scene was dropped: not recorded, and the video was over 3 minutes.)

**Rhythm:** slow where people read (chat, rule, agent answer), quick at transitions (light trails, cuts). Every real-app shot gets a slow zoom onto the part that matters. Music: a calm ambient bed that lifts at scene 6 and rises in scene 7.

## Scenes

| # | Time | Narration | On screen | Source |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:13 | Northern Finland. Veikko has just replaced an optical module on node TRN-042. The link is up. Optics are normal. Alarms have cleared. But traffic isn't coming back. | Blue hour, snow. A field engineer with a headlamp at an equipment cabinet under a mast, laptop open. Captions fade in one by one: `LINK UP` · `OPTICS OK` · `ALARMS CLEARED`, then in red `TRAFFIC 0` | Pruna video + animated captions |
| 2 | 0:13–0:38 | He asks Erkki, a senior network expert. Erkki has seen this before. *(the chat plays, no voice)* Twelve messages. One sentence of real knowledge. And it was never written down. | Erkki at a desk, warm light (Pruna, 2 s). Then a clean chat between the two, bubble by bubble at reading pace (Elisa's example chat). "Traffic is back 👍". Slow zoom: "Is this documented somewhere?" → "Not that I know of 😄". The smiley holds; the rest dims | Pruna + animation |
| 3 | 0:38–0:45 | Hidden knowledge? Not anymore. This is ElidEx. | The useful sentences start to glow. Title: **ElidEx**: *Hidden knowledge? No thank you!* (the deck's tagline) | Animation + home page (clip A) |
| 4 | 0:45–1:14 | *(on screen: Capture)* ElidEx reads the chats and emails people already use. No form, no tag, no extra click. It picks out the sentences that carry knowledge and turns them into a rule an agent can read, and a second model checks that every quote is really there. *(on screen: Link)* Then it ties the rule to the network: TRN-042, and the older units of the same kind. Not every node: a wrong link is worse than none. Each rule keeps its source, how sure it is and why, and how long it stays true. | Chapter mark *Capture*. **The ball of light:** the glowing sentences lift off the chat, merge into one light and fly into the network graph. Real pipeline view of the thread (clip B). Chapter mark *Link*: the light lands on TRN-042, then flows along the graph to the older units of the same kind while newer units stay dark. Tags appear one at a time: source *Erkki, chat*, trust *verified*, validity *from today, still true*. Real rule card with its "why this trust" explanation (clip C), then the real graph (clip D) | Animation + clips B, C, D |
| 5 | 1:14–1:50 | *(on screen: Reuse)* Three weeks later, three a.m. Same symptoms on TRN-117, another older unit. Erkki is asleep, and nobody needs to wake him. The agent asks ElidEx what the network knows, checks the conditions (link up, optics normal, counters at zero) and proposes Erkki's fix: bounce the interface, before any hardware swap or reboot. With its source, and why. When the technician reports traffic is back, the rule gains new evidence. Nobody filled in anything. | Chapter mark *Reuse*. Night shot of another remote site in the snow (Pruna). Incident card TRN-117 pops in; three observation chips get a check mark one after the other. **The light travels back** from the graph to the agent. Real Agent tester answer (clip E); zoom on the steps, then on the source and the reason. A reply "traffic is back" lands, and the rule's trust badge pulses | Pruna + animation + clip E |
| 6 | 1:50–2:20 | And it doesn't stop at single conversations. Two radios in Lapland and a node in Oulu run into trouble at the same time. Three reports, three different people. Nobody connects them. ElidEx does. From what people said and the network's topology, it sees that all three depend on TRN-131, a node nobody mentioned. A hypothesis to check, never a rule. It also notices when a quick fix keeps coming back: Erkki's trick was needed on three units, and the lasting fix, firmware 4.2, has not reached them yet. | Three report cards slide in (RAD-198, RAD-221, TRN-117). Real Insights map (recording 2, 0:00–0:03): dashed lines meet at TRN-131, which pulses: *nobody reported it*. Caption: *Built from what people said and the network topology. No alarms, no telemetry.* Zoom on the hypothesis text. Then the Recurring tab (recording 2, 0:03): zoom on *TRN-042 · TRN-088 · TRN-117: lasting fix known, not rolled out on 3 units* | Animation + recording 2 |
| 7 | 2:20–2:30 | No forms. No extra work. Just a network that remembers. ElidEx, by The Trappists. | End card: **ElidEx** · *Hidden knowledge? No thank you!* · Bilal Vandenberge · Manuel Rocca · Haluk Yilmaz · Matteo Morbée · The Trappists · Since AI 2026, Elisa challenge. Small line: *Exportable as JSON, Markdown, CSV, GraphML, JSON-LD* | Animation |

Timing: about 340 words of narration (about 2:25 at a calm pace) plus the silent chat moment, so about 2:45 in total.

## Narration only (for the voice, one file per scene)

The voice is generated by `demo-video/tools/make_voice.py` (outside the repo), voice *Sayuri*, one file per scene. Chapter words (Capture, Link, Reuse) and titles are **on screen only, never spoken**. "ElidEx" is sent as "Ellidex" (the *i* as in *Alice*); node ids are spelled ("T-R-N zero four two").

1. Northern Finland. Veikko has just replaced an optical module on node TRN-042. The link is up. Optics are normal. Alarms have cleared... But traffic isn't coming back.
2. He asks Erkki, a senior network expert. Erkki has seen this before. … Twelve messages. One sentence of real knowledge. And it was never written down.
3. Hidden knowledge? Not anymore. This is ElidEx.
4. (capture) ElidEx listens to the chats and emails people already use. No form. No tag. No extra click. It finds the few sentences that matter, and turns them into a rule an agent can read.
   (link, after a breath) Then it links that rule to the right place in the network: TRN-042, and the older units like it. Not every node. A wrong link is worse than none. And every rule keeps its source, and how far to trust it.
5. Three weeks later. Three a.m. Same symptoms on TRN-117, another older unit. Erkki is asleep, and nobody needs to wake him. The agent asks ElidEx what the network knows, checks the conditions, and proposes Erkki's fix: bounce the interface, before any hardware swap or reboot. With its source. And when the technician reports that traffic is back, the rule gains new evidence. Nobody filled in anything.
6. ElidEx doesn't only learn from the knowledge hidden between employees. It also learns from the network itself. Two radios in Lapland and a node in Oulu run into trouble at the same time. Nobody connects them. ElidEx does: from the network's topology, it sees that all three depend on TRN-131, a node nobody mentioned. A hypothesis to check, never a rule. And it spots recurring problems: Erkki's trick was needed on three units, and the lasting fix, firmware 4.2, hasn't reached them yet. So the company can fix it once and for all.
7. The knowledge was always there, hidden in everyday conversations. ElidEx puts it in the spotlight.

## Footage to record (real app)

**Settings for every clip:**
- Highest screen resolution (1440p ideal, 1080p minimum), 60 fps.
- Browser full screen (F11), notifications off, the same theme for all clips.
- Move the mouse slowly; hold still about 3 s before and after each click.
- Each clip can be 10–60 s; extra length is fine.

**Setup:** start the Workbench locally and clear it (Data page, reset to empty) so the knowledge appears from nothing. Prefer the real LLM for clips B and C. If you must use the offline (`scripted`) mode, tell me, so the narration does not claim live extraction.

| Clip | Scene | What to show |
| --- | --- | --- |
| A | 3 | Home page: hold on the hero, then slow scroll |
| B | 4 | Run the scenario `elisa-trn042-chat`. Open the thread in Conversations and step through each pipeline stage (hold each), including the critic's verdict |
| C | 4 | Knowledge: open the new rule; its source messages, scope (TRN-042 + older units), validity, and the trust/confidence explanation |
| D | 4 | Graph: search TRN-042, click the rule node, let the neighbours appear; one slow drag |
| E | 5 | Agent tester (`/agent`): a case on TRN-117 with SFP swapped, link UP, optics normal, counters 0. Show the recommendation, its source and the "why" |
| F | 6 | Run `pattern-trn131-traffic-drop-evening`, `pattern-trn229-sync-loss-evening` and their two `…-again` scenarios. Insights: the map, the pattern with TRN-117 as the shared suspect, "Who to ask". Then run `pattern-trn117-clock-module` and show the pattern resolved |
| G | dropped | Company day (`/company`): start a day from empty and let it run 1–2 minutes of real time; I will speed it up. Show the chats, the graph growing and the agent calls |
| H (optional) | 4 | Slack: a persona posts, and the knowledge appears in the Workbench seconds later, both screens side by side |

## Generated shots (Pruna)

Stills first with `p-image` (cheap, to fix the look), then animated with `p-video-2` (1080p; draft mode for previews). No readable text or logos in generated shots: every text on screen comes from our own animations.

| Shot | Scene | Content |
| --- | --- | --- |
| P1 | 1 | Blue hour, snow falling, Finnish Lapland. A field engineer with a headlamp at a grey equipment cabinet beside a telecom mast, laptop open on the cabinet shelf; slow push in, 5 s |
| P2 | 2 | A senior engineer in his fifties at a desk, warm lamp light, reading his phone and starting to type; 2–3 s |
| P3 | 5 | Night, a remote transmission site in the snow, a single light on the shelter, wind; 3 s |

## Open questions

1. Voice: which of the samples (George, Daniel, Alice, Brian)?
2. Music: royalty-free ambient track, or generated with ElevenLabs Music (the key needs the Music permission)?

> Layout rule: the bottom of the frame stays free for subtitles; captions sit at the top, the opening status chips at the middle left.
