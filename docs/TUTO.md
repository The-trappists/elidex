# A Non-Technical Guide: Understanding Valid vs. Failed Scenarios (TUTO.md)

Imagine this project as a **smart operational notebook** for a telecom company.

Network engineers and field technicians talk in Slack or Teams all day. The AI reads those chats, finds useful tips (like *"how to enter a locked site"* or *"what to do when an antenna crashes"*), and writes them down on digital index cards so that future maintenance bots can do their job without bothering humans.

This guide explains in plain English why the screen looked green, what the difference is between "valid" and "failed" scenarios, and how to explain the underlying logic failures clearly.

---

## 1. Why Did the Screen Look "Green" and "Resolved"?

When you ran the scenarios on the frontend, the UI showed checkmarks and success badges.

To the computer, **"Success" simply meant: "I didn't crash."**
- It read the text.
- It called the AI.
- It generated index cards.
- It drew lines on the graph.

It is like an intern who was asked to summarize a messy conversation: they handed you a neat, well-formatted piece of paper on time. At a glance, the job looks done! But it is only when you actually read the paper and try to follow the advice that you spot the logic flaws.

---

## 2. The Core Difference: Valid Scenarios vs. Failed Scenarios

### In the "Valid" Scenarios (Normal, Predictable World):
People speak politely and sequentially:
> *"The key to site Kemijärvi is at the Shell station."*  
> *(A few days later)*: *"Wait, that was last month. The key was moved to the Esso station today."*

The system easily understands:
*"Aha! The old key was at Shell, but that was in the past. Today it is at Esso. I will cross out Shell and write Esso."*

---

### In the "Failed" Scenarios (Real Human Messiness):
Humans don't speak like textbooks. They rant, they use slang, they disagree, and they talk about two things in the very same breath. Here are the **3 big problems** that broke the system:

---

### Problem 1: "The Frozen Lock" (Old Advice Never Dies)
* **The Human Story**: A technician drives through a blizzard, gets angry about spilled coffee, hammers on an old frozen lock with code `1234`, and says: *"That lock is broken forever. The new code is 8842."*
* **What the computer is supposed to do**: Throw away `1234` and save `8842`.
* **What actually happened**: 
  The system has a rule: *"Only erase an old card if the new message arrived at a strictly later time."*
  Because both statements were in the **exact same conversation at the exact same minute**, the computer said: *"Wait, this replacement isn't from the future, it's from the same time! I can't erase the old one."*
* **The Failure**: Both code `1234` and code `8842` are marked as **currently active**. If an emergency repair robot drives out at 2 AM, it gets handed two different lock codes and has no idea which one works.

---

### Problem 2: "The Disagreeing Doctors" (Silent Erasure)
* **The Human Story**: Two technicians look at a vibrating cabinet in a basement.
  - Person A says: *"The cabinet is shaking because the cleaning lady's floor buffer bumped it."*
  - Person B says: *"No, the cabinet is shaking because the internal fan is broken."*
  Notice: neither person told anyone to *push a button* or *pull a plug*—they are just giving their diagnostic opinion (facts).
* **What the computer is supposed to do**: Flag a conflict: *"Alert: Two experts disagree on why it's shaking."*
* **What actually happened**: 
  The computer has a rule: *"If two people recommend the same action, merge their notes together."* 
  Since neither recommended an action, the computer checked: `Is "nothing" equal to "nothing"? Yes!`
* **The Failure**: The computer thought both people agreed! It quietly erased Person A's opinion and kept Person B's. The disagreement completely vanished from the system.

---

### Problem 3: "Don't Push the Button!" (The Negation Trap)
* **The Human Story**: Two night-shift workers use gaming slang and finish with: *"Whatever you do, **NEVER reboot** the box or it will die permanently."*
* **What the computer is supposed to do**: Put a giant **DO NOT REBOOT** warning in the system.
* **What actually happened**: 
  When the automated guard checks future actions, it only looks for keywords. It sees the word **"reboot"**, but it is completely blind to the word **"NEVER"** or **"DON'T"**.
* **The Failure**: It interprets *"Never reboot"* as an intention *to reboot*. The safety guard completely inverts the human's safety instruction.

---

## 3. How to Explain This Clearly to Others (The Elevator Pitch)

When presenting or explaining this to teammates, judges, or mentors:

> *"The frontend shows everything as green because the AI successfully parsed the messages without crashing.*
> 
> *However, stress-testing it with real human messiness uncovered silent logic flaws:*
> 1. ***Timestamp Blindness***: *When an obsolete rule and its replacement are mentioned in the same chat, the old rule is never cancelled—both stay active forever.*
> 2. ***False Agreement***: *When two experts disagree on a problem's cause without prescribing an action, the system thinks they agree and silently deletes one person's opinion.*
> 3. ***Negation Blindness***: *The safety guard searches for action words like 'reboot', but misses words like 'never' or 'avoid', accidentally treating warnings as commands.*
>
> *The AI can read the text, but the business logic underneath needs to understand human contradiction and negation."*
