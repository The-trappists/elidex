// Generated once from data/dashboard/scenarios (verbatim message text). Sample data for the review fixtures.
import type { LiveThread } from '../types'

export const FIXTURE_THREADS: LiveThread[] = [
  {
    "id": "FX-176",
    "source": "slack",
    "subject": "#radio-field",
    "messages": [
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 1,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T08:10:05",
        "text": "random q. 176 keeps showing a link margin warning on cold mornings, is that known?"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 2,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-05T08:10:45",
        "text": "176 is the one in Rovaniemi?"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 3,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T08:11:10",
        "text": "no, Hervanta. the node, TRN-176"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 4,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-05T08:11:40",
        "text": "hm. then I was thinking of the other 176"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 5,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-05T08:11:49",
        "text": "RAD-176. the RU-200 at Ounasvaara"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 6,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T08:12:14",
        "text": "oh there are two 176s 😅 go on"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 7,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-05T08:12:49",
        "text": "on that one, RAD-176, the margin dips on hard frost mornings. below minus 25"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 8,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-05T08:12:59",
        "text": "it comes back on its own when the heater has warmed the unit, about 20 min. only this unit tho, its antenna sits in the shade of the cliff. the other RU-200s are fine. don't go up and realign it. ask me how I know. three times"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 9,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T08:13:59",
        "text": "+1 for not realigning. wasted a trip to Ounasvaara in January 😅"
      },
      {
        "thread_id": "FX-176",
        "source": "slack",
        "seq": 10,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T08:14:29",
        "text": "good to know. so for the Hervanta 176 I need to look elsewhere. will check the dashboard"
      }
    ],
    "participants": [
      "Helmi Hakkarainen",
      "Raimo Rantanen",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "ambiguous-number-clash-176",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-05T08:10:00",
    "last_message_at": "2026-11-05T08:14:29",
    "last_job_id": "FXJ-176"
  },
  {
    "id": "FX-TURKU",
    "source": "teams",
    "subject": "Turku node: management port after power cycle",
    "messages": [
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 1,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:30:05",
        "text": "hey, quick one. the Turku node was power cycled this morning after the maintenance window and I still can't reach its management port"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 2,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:30:14",
        "text": "should I just cycle it again?"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 3,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T09:31:04",
        "text": "Which one? Turku has Kupittaa and the harbour hut."
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 4,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:31:29",
        "text": "hmm. the ticket just says 'Turku node'. veikko you were there last week right?"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 5,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T09:32:14",
        "text": "yes the old one, Kupittaa 👍 the harbour hut one is the new TX-5000, they only put that in last year"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 6,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:32:34",
        "text": "ah ok so that's TRN-042 then"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 7,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T09:33:14",
        "text": "Hm. Then don't cycle it again. The 3.8 boxes need around 8 minutes after a cold start before the management port answers. Traffic is fine in the meantime."
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 8,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T09:33:44",
        "text": "oh that explains why it looked dead when I stood in front of it last time"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 9,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:34:54",
        "text": "ok waiting. kahvi ☕"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 10,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-05T09:37:54",
        "text": "port is back, took 9 min. as you said"
      },
      {
        "thread_id": "FX-TURKU",
        "source": "teams",
        "seq": 11,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T09:38:34",
        "text": "Good."
      }
    ],
    "participants": [
      "Erkki Expert",
      "Helmi Hakkarainen",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "ambiguous-two-turku",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-05T09:30:00",
    "last_message_at": "2026-11-05T09:38:34",
    "last_job_id": "FXJ-TURKU"
  },
  {
    "id": "FX-SFP",
    "source": "teams",
    "subject": "TRN-088 first step after SFP swap",
    "messages": [
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 1,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T11:00:05",
        "text": "Hei! I'm at Kangas, TRN-088. Swapped the SFP, link is UP but the counters are stuck at zero and the optics look normal. What do I try first, bounce the interface or something else?"
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 2,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T11:01:15",
        "text": "Bounce it. Disable, wait a bit, enable. On the old TX-3000s that's always step one."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 3,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-05T11:02:35",
        "text": "Hmm, I'd disagree. The vendor guide for the TX-3000 says reseat the module first."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 4,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-05T11:02:47",
        "text": "A half-seated module also gives you link UP with zero counters. I've seen it."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 5,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T11:03:47",
        "text": "Reseating means a second optics reset and a second outage window. Bounce is quicker and it has worked every single time 😄"
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 6,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-05T11:04:57",
        "text": "Every time you've tried it, yes 🙂 I'd still reseat first on anything up to 2019, then bounce if that fails."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 7,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T11:05:42",
        "text": "We'll see. Veikko, your call."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 8,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T11:07:22",
        "text": "ok ok. going with Erkki's way, it's quicker and my window is closing"
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 9,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-05T11:10:02",
        "text": "bounced it. traffic is back! 🎉"
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 10,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-05T11:10:52",
        "text": "Fine, fine. I still think someone should settle this and put it in the field instructions."
      },
      {
        "thread_id": "FX-SFP",
        "source": "teams",
        "seq": 11,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-05T11:11:22",
        "text": "Agreed on that one."
      }
    ],
    "participants": [
      "Aino Arkkitehti",
      "Erkki Expert",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "expert-disagreement",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-05T11:00:00",
    "last_message_at": "2026-11-05T11:11:22",
    "last_job_id": "FXJ-SFP"
  },
  {
    "id": "FX-VENDOR",
    "source": "slack",
    "subject": "#transmission",
    "messages": [
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 1,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-06T07:45:05",
        "text": "morning! TRN-229 at Linnanmaa lost power for a few seconds about an hour ago (mains blip, the UPS didn't hold). node is back but the link is DOWN and alarms are still on. optics look ok. I'm thinking reboot?"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 2,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-06T07:46:05",
        "text": "Hm. Reboot is my usual answer. Is the power definitely stable now?"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 3,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-06T07:46:35",
        "text": "yep, stable for 40 min"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 4,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-06T07:47:45",
        "text": "wait before you reboot"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 5,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-06T07:47:55",
        "text": "I asked vendor support about exactly this last week for the TX-5000s. they said after even a short power dip the node needs about 15 min to get sync back, and a reboot just restarts that clock"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 6,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-06T07:48:15",
        "text": "caveat: that's only their word, I haven't seen it happen myself 🤷"
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 7,
        "author": "Erkki Expert",
        "role": "Network Expert",
        "sent_at": "2026-11-06T07:49:05",
        "text": "Never seen it on any of mine. But waiting costs nothing, so fine by me."
      },
      {
        "thread_id": "FX-VENDOR",
        "source": "slack",
        "seq": 8,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-06T07:49:45",
        "text": "ok, I'll wait 15 and see. will report back"
      }
    ],
    "participants": [
      "Aino Arkkitehti",
      "Erkki Expert",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "slack-vendor-secondhand",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-06T07:45:00",
    "last_message_at": "2026-11-06T07:49:45",
    "last_job_id": "FXJ-VENDOR"
  },
  {
    "id": "FX-FW42",
    "source": "teams",
    "subject": "Firmware 4.2 makes the bounce trick obsolete",
    "messages": [
      {
        "thread_id": "FX-FW42",
        "source": "teams",
        "seq": 1,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-06T09:00:05",
        "text": "Heads up team: the firmware 4.2 rollout to all transmission nodes installed 2019 or earlier finished last night. Release notes say it fixes the forwarding-state bug after optical module replacement."
      },
      {
        "thread_id": "FX-FW42",
        "source": "teams",
        "seq": 2,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-06T09:02:05",
        "text": "So no more disable/enable trick after SFP swaps?"
      },
      {
        "thread_id": "FX-FW42",
        "source": "teams",
        "seq": 3,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-06T09:05:05",
        "text": "Correct, it shouldn't be needed anymore on those units. If you still see zero counters after a swap, it's something else."
      },
      {
        "thread_id": "FX-FW42",
        "source": "teams",
        "seq": 4,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-06T09:06:05",
        "text": "👍"
      }
    ],
    "participants": [
      "Aino Arkkitehti",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "firmware-4-2-rollout",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-06T09:00:00",
    "last_message_at": "2026-11-06T09:06:05",
    "last_job_id": "FXJ-FW42"
  },
  {
    "id": "FX-SODANKYLA",
    "source": "slack",
    "subject": "#field-north",
    "messages": [
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 1,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-06T13:20:05",
        "text": "going to Sodankylä fell mast tomorrow, ticket says 'restart the radio there'. but there are two radios in the cabinet?? which one? 😬"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 2,
        "author": "Liisa Lappi",
        "role": "Field Team Lead North",
        "sent_at": "2026-11-06T13:20:55",
        "text": "the old one. the other one is fine as far as I remember"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 3,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-06T13:21:25",
        "text": "old as in... the one with more dust?"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 4,
        "author": "Liisa Lappi",
        "role": "Field Team Lead North",
        "sent_at": "2026-11-06T13:21:45",
        "text": "😂 joo roughly"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 5,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-06T13:22:30",
        "text": "wait. the old one is the RU-200, RAD-198. the newer one is RAD-233"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 6,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-06T13:22:42",
        "text": "restarting RAD-198 is fine, but it forgets the antenna profile on 2.3"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 7,
        "author": "Raimo Rantanen",
        "role": "Radio Specialist",
        "sent_at": "2026-11-06T13:22:52",
        "text": "after the restart, front panel menu, 'Load profile 1'. otherwise it comes up on the factory profile and the link is bad"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 8,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-06T13:23:27",
        "text": "ohh ok. so restart, then load profile 1. kiitos!"
      },
      {
        "thread_id": "FX-SODANKYLA",
        "source": "slack",
        "seq": 9,
        "author": "Liisa Lappi",
        "role": "Field Team Lead North",
        "sent_at": "2026-11-06T13:24:07",
        "text": "and take a headlamp, the cabinet has no light 🔦"
      }
    ],
    "participants": [
      "Jaakko Junnila",
      "Liisa Lappi",
      "Raimo Rantanen"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "ambiguous-old-radio-sodankyla",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-06T13:20:00",
    "last_message_at": "2026-11-06T13:24:07",
    "last_job_id": "FXJ-SODANKYLA"
  },
  {
    "id": "FX-HELSINKI",
    "source": "slack",
    "subject": "#noc-general",
    "messages": [
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 1,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-07T08:30:05",
        "text": "Hei! I'm preparing my visit to Helsinki Pasila next week and somebody told me one of the boxes there drops traffic if you plug anything into the second port?? is that true? which one is it? I don't want to break anything in my first month"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 2,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-07T08:31:05",
        "text": "oh yeah I heard that too. second port, don't plug anything in 👍"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 3,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-07T08:31:45",
        "text": "which box tho. there are like four things in that room"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 4,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-07T08:32:15",
        "text": "the one near the door I think? not sure"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 5,
        "author": "Aino Arkkitehti",
        "role": "Network Architect",
        "sent_at": "2026-11-07T08:33:10",
        "text": "Heads up: I can't tell from the inventory which one that would be. Pasila has two TX-3000, one TX-5000 and the router. Nothing in the release notes about a port 2 issue either."
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 6,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-07T08:33:45",
        "text": "so should I avoid the second port on all of them?"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 7,
        "author": "Veikko Vikkelä",
        "role": "Field Engineer",
        "sent_at": "2026-11-07T08:34:10",
        "text": "lol I'd ask Erkki"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 8,
        "author": "Helmi Hakkarainen",
        "role": "NOC Operator",
        "sent_at": "2026-11-07T08:35:20",
        "text": "he's off until Monday. let's park it, someone ask him then"
      },
      {
        "thread_id": "FX-HELSINKI",
        "source": "slack",
        "seq": 9,
        "author": "Jaakko Junnila",
        "role": "Junior Field Engineer",
        "sent_at": "2026-11-07T08:35:40",
        "text": "ok kiitos, I'll ask him Monday"
      }
    ],
    "participants": [
      "Aino Arkkitehti",
      "Helmi Hakkarainen",
      "Jaakko Junnila",
      "Veikko Vikkelä"
    ],
    "origin": "synthetic",
    "status": "processed",
    "scenario_id": "ambiguous-helsinki-unresolved",
    "incident_id": null,
    "slack_ts": null,
    "created_at": "2026-11-07T08:30:00",
    "last_message_at": "2026-11-07T08:35:40",
    "last_job_id": "FXJ-HELSINKI"
  },
]
