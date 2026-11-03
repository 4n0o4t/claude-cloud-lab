"""演示用假 LLM 接口：模拟 OpenAI Responses API 的流式返回，驱动 wolfai-killer 跑完一局“剧本局”。

只用于录宣传片素材：真实的游戏引擎、WebSocket 和前端照常运行，只是 AI 的回答由这里按剧本给出。
剧本针对“标准六人局”（2 狼 + 预言家 + 女巫 + 守卫 + 村民），座位随机也能用：
身份通过上帝模式接口实时查询，不靠猜。

剧情：
  第 1 夜  狼刀守卫，守卫守预言家，女巫开解药 → 平安夜；预言家查验 1 号狼（W1）。
  第 1 天  预言家报查杀，W1 悍跳反咬，W2 站边 W1；好人 4 票出 W1，W1 留遗言。
  第 2 夜  狼刀预言家（守卫不能连守，预言家倒下）；女巫毒 W2 → 狼人全灭，好人获胜。

用法：
    python tools/mock_llm.py --port 8900 --backend http://127.0.0.1:8101 --delay 1.6
    # 建局后要告诉它对局 ID 和上帝密码（tools/record.mjs 会自动做）：
    curl -X POST 127.0.0.1:8900/director -d '{"game_id":"...","password":"..."}'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
STATE: dict[str, Any] = {"game_id": None, "password": "", "backend": "", "delay": 1.0}

# ---------- 身份查询 ----------


async def roles() -> dict[str, Any]:
    """返回 {'W': [狼座位], 'S': 预言家, 'WI': 女巫, 'G': 守卫, 'V': 村民, 'alive': {...}}。"""
    gid = STATE["game_id"]
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(
            f"{STATE['backend']}/api/game/{gid}/god-mode/players",
            headers={"X-God-Password": STATE["password"]},
        )
        st = (await c.get(f"{STATE['backend']}/api/game/{gid}/status")).json()
    ps = r.json()
    out: dict[str, Any] = {
        "W": [],
        "alive": {p["seat"] for p in ps if p.get("alive", True)},
        "night": int(st.get("night_count") or 0),
        "day": int(st.get("day_count") or 0),
    }
    for p in ps:
        role = p["role"]
        if "狼" in role:
            out["W"].append(p["seat"])
        elif role == "预言家":
            out["S"] = p["seat"]
        elif role == "女巫":
            out["WI"] = p["seat"]
        elif role == "守卫":
            out["G"] = p["seat"]
        else:
            out["V"] = p["seat"]
    out["W"].sort()
    return out


# ---------- 剧本 ----------

SEER_CLAIM = "昨晚验了"  # 真预言家报查杀的标志
WOLF_CLAIM = "我才是真预言家"  # 悍跳狼的标志


def speech(r: dict[str, Any], seat: int, day: int, context: str) -> str:
    """台词随场上已发生的发言变化：没人起跳、一边起跳、两边对跳。"""
    W1, W2 = r["W"][0], r["W"][1]
    S, WI, G = r["S"], r["WI"], r["G"]
    if day >= 2:
        return "天亮了还在，说明我们方向是对的，继续盘。"
    seer_said, wolf_said = SEER_CLAIM in context, WOLF_CLAIM in context
    if seat == S:
        if wolf_said:
            return f"我才是预言家！{W1}号就是我昨晚验了的查杀，被验到就反手悍跳。今天必须出{W1}号。"
        return f"我是预言家，昨晚验了{W1}号，查杀！平安夜说明女巫开了药，今天全票出{W1}号，别犹豫。"
    if seat == W1:
        if seer_said:
            return f"笑死，我才是真预言家，昨晚验的{S}号就是狼！{S}号被我验到了急着反手悍跳，好人别被带节奏。"
        return f"我才是真预言家，昨晚验的{S}号，查杀！{S}号待会儿要是起跳，那就是悍跳狼，大家看清楚。"
    if not (seer_said or wolf_said):
        return {
            W2: "首夜平安夜挺好，我先听，谁跳预言家我认真盘他的验人逻辑。",
            WI: "平安夜我心里有数，先不多说，等后面的人跳身份再表态。",
            G: "我是好人，首夜信息太少，先听后置位，有跳预言家的我会认真听。",
        }.get(seat, "平民一张，没什么信息，先听预言家怎么说。")
    if not (seer_said and wolf_said):
        claimant = S if seer_said else W1
        if seat == W2:
            return f"{claimant}号起跳了，我先不站边，等对面跳不跳再说。"
        return f"{claimant}号起跳报了查杀，我先信一半，就看对面会不会反跳。"
    return {
        W2: f"两个预言家对跳，说实话我觉得{W1}号语气更真。{S}号话说得太满，有点急，我先站{W1}号。",
        WI: f"平安夜我心里有数，我站{S}号。{W2}号这么着急帮{W1}号挡刀，我记住你了。",
        G: f"我是好人，两个预言家里我更信{S}号，{W1}号报的验人理由太空。先出{W1}号，晚上再看。",
    }.get(seat, f"我就是个平民，听下来{W1}号像被查杀后硬跳的。我跟{S}号走，投{W1}号。")


async def answer(instructions: str, prompt: str) -> tuple[str, float]:
    """根据提示词类型返回 (文本, 延迟秒)。"""
    text = instructions + "\n" + prompt
    r = await roles()
    W1, W2 = r["W"][0], r["W"][1]
    d = STATE["delay"]

    if "白天发言阶段" in text:
        seat = int(re.search(r"作为\s*(\d+)\s*号", text).group(1))
        return speech(r, seat, r["day"], prompt), d * 2.2
    if "刚因白天投票结算出局" in text:
        return f"出我可以，但{r['S']}号绝对是狼。明天你们就知道票投错了。", d * 2
    if "白天投票阶段" in text:
        seat = int(re.search(r"你是\s*(\d+)\s*号", text).group(1))
        target = r["S"] if seat in r["W"] else W1
        if target not in r["alive"] or target == seat:
            target = next(s for s in sorted(r["alive"]) if s != seat)
        return json.dumps({"target": target}), d * 0.8
    if "狼人需要选择一个好人击杀" in text:
        target = r["G"] if r["night"] <= 1 else r["S"]
        return str(target), d
    if "选择一个玩家查验" in text:
        return str(W1 if r["night"] <= 1 else W2), d
    if "选择一个玩家守护" in text:
        return str(r["S"] if r["night"] <= 1 else r["WI"]), d
    if "是否使用解药" in text:
        return "是", d
    if "使用毒药" in text:
        return (str(W2) if r["night"] >= 2 else "不用"), d
    return "好的。", 0.2


# ---------- Responses API 外壳 ----------


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/director")
async def director(req: Request):
    body = await req.json()
    STATE["game_id"] = body["game_id"]
    STATE["password"] = body.get("password", "")
    return {"ok": True}


@app.post("/v1/responses")
async def responses(req: Request):
    body = await req.json()
    instructions = body.get("instructions") or ""
    prompt = "\n".join(
        c.get("text", "") if isinstance(c, dict) else str(c)
        for m in body.get("input", [])
        for c in (m.get("content") if isinstance(m.get("content"), list) else [{"text": m.get("content", "")}])
    )
    if not STATE["game_id"]:
        return JSONResponse({"error": "director not set"}, status_code=503)
    text, delay = await answer(instructions, prompt)
    rid = f"resp_{int(time.time() * 1000)}"

    async def gen():
        yield sse("response.created", {"response": {"id": rid, "status": "in_progress"}})
        await asyncio.sleep(delay)
        yield sse(
            "response.completed",
            {
                "response": {
                    "id": rid,
                    "status": "completed",
                    "output_text": text,
                    "usage": {"input_tokens": len(prompt) // 2, "output_tokens": len(text)},
                }
            },
        )

    return StreamingResponse(gen(), media_type="text/event-stream")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8900)
    ap.add_argument("--backend", default="http://127.0.0.1:8101")
    ap.add_argument("--delay", type=float, default=1.0, help="基础响应延迟（秒），控制对局节奏")
    a = ap.parse_args()
    STATE["backend"] = a.backend
    STATE["delay"] = a.delay
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")
