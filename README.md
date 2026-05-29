### How to run
```
npm install
npm run dev
```

Open localhost:5173

#### Design thoughts
With a task like this, I like to have an idea of what strategy I want to employ, but I use the agent to consider other options and to help me pick out any weaknesses with my idea. Helps include features I hadn't considered or vulnerabilities that an alternative or hybrid approach might fix. 

In this app, we combine a global state object with a reducer to trigger movement every 100 ms. On tick: update pedestrians => run the signal logic to figure out what is next (straight => yellow => all-red => protected left => yellow => all-red => swap axis) => move cars => spawn new cars at random, remove ones that are no longer on screen. Permissive left turns calculate oncoming straight cars to make sure they won't collide before they enter the intersection. All cars will proceed through the intersection if they can get past the stop line before it turns red. 

Generally, I try to avoid "This doesn't work, fix it" prompts. AI tools need clear explanations of the problem and a clear description of what it means to truly fix an issue, otherwise it hallucinates the problem and answer. That's why in some prompts you'll see I suggest where the bug is and what means it's working vs not working. There aren't really any established patterns in this codebase, but when there are, I make sure to use context or prompts to ensure proper structure is used.

I've been keeping a few more comments from agents than I used to. I think the way the tools search with keywords is helped with more comments, even though it's typically desirable to avoid too many comments.

The transcript is available as traffic_chat.json, I stripped out the biggest properties in the .stripped version to make it easier to review. 