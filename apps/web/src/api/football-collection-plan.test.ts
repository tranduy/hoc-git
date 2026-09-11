import {expect,it} from "vitest";
import { FootballCollectionPlanPublisher } from "./football-collection-plan.js";

it("coalesces quotes but renews the plan lease and urgent roster changes", async () => {
  const requests:unknown[]=[];
  const publisher = new FootballCollectionPlanPublisher(async (_url,init) => {
    requests.push(JSON.parse(String(init?.body))); return new Response("{}",{status:200});
  });
  const plan = {revision:1,events:[{eventId:"one",startAtUtcMs:100000,isLive:false,urgent:false}]};
  await publisher.publish(new Map([["SABA",plan]]),1000);
  await publisher.publish(new Map([["SABA",{...plan,revision:2}]]),2000);
  expect(requests).toHaveLength(1);
  await publisher.publish(new Map([["SABA",plan]]),31000);
  expect(requests).toHaveLength(2);
  expect((requests[1] as {plan:{revision:number}}).plan.revision)
    .toBeGreaterThan((requests[0] as {plan:{revision:number}}).plan.revision);
  await publisher.publish(new Map([["SABA",{...plan,events:[{...plan.events[0]!,urgent:true}]}]]),32000);
  expect(requests).toHaveLength(3);
});

it("contains network failures so older APIs do not break the dashboard", async () => {
  const publisher = new FootballCollectionPlanPublisher(async () => {throw new Error("offline");});
  await expect(publisher.publish(new Map([["BTI",{revision:1,events:[]}]]),1000)).resolves.toBeUndefined();
});

it("records rejected HTTP publication and retries on the bounded lease interval", async () => {
  let attempts=0;
  const publisher=new FootballCollectionPlanPublisher(async () => new Response("{}",{status:++attempts === 1 ? 503 : 200}));
  const plans=new Map([["SABA" as const,{revision:1,events:[]}]]);
  await publisher.publish(plans,1000);
  expect(publisher.lastError("SABA")).toBe("HTTP 503");
  await publisher.publish(plans,1001);
  expect(attempts).toBe(1);
  await publisher.publish(plans,31000);
  expect(publisher.lastError("SABA")).toBeNull();
});
