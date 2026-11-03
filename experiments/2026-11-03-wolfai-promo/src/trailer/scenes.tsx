/* 第二版各幕。每幕在自己的 Sequence 里，帧号从 0 开始；lb(n) = 本幕第 n 拍。 */
import React from 'react';
import {AbsoluteFill, Img, interpolate, random, useCurrentFrame} from 'remotion';
import {
  Arc,
  BLOOD,
  BONE,
  Chip,
  DIM,
  FlipCard,
  GOLD,
  INK,
  Latin,
  MOONBLUE,
  ROLES,
  RiseText,
  RoleCard,
  SERIF,
  Screen,
  SeatDisc,
  Typed,
  asset,
  clamp,
  ease,
  easeIO,
  lb,
  role,
  seatPos,
  useSpring,
} from './kit';

/* 本局真实座次（tools/capture.mjs 那一局，见 tools/cap-index.json） */
const SEATS: Record<number, string> = {1: 'SEER', 2: 'GUARD', 3: 'WITCH', 4: 'VILLAGER', 5: 'WOLF', 6: 'WOLF'};

/* ============ 1. 开场：狼浮雕 + 逐拍大字 ============ */

const HOOK_WORDS: {at: number; zh: string; la: string; color?: string; size?: number}[] = [
  {at: 2, zh: '今夜', la: 'TONIGHT'},
  {at: 4, zh: '六个 AI', la: 'SIX MINDS'},
  {at: 6, zh: '围坐一桌', la: 'ONE TABLE'},
  {at: 8, zh: '其中两个', la: 'TWO OF THEM'},
  {at: 10, zh: '是狼。', la: 'ARE WOLVES', color: BLOOD, size: 260},
];

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [0, lb(9)], [0, 0.5], {...clamp, easing: easeIO});
  const flare = interpolate(frame, [lb(10), lb(10) + 4, lb(12)], [0, 1, 0.6], clamp);
  const push = interpolate(frame, [0, lb(12)], [1.0, 1.12], clamp);
  return (
    <AbsoluteFill style={{background: INK}}>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 55%, ${BLOOD}${Math.round(20 + flare * 50).toString(16)} 0%, transparent 55%)`}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', transform: `scale(${push})`}}>
        <div style={{position: 'relative', width: 980, height: 980}}>
          <Img
            src={asset('hero-wolf.png')}
            style={{width: '100%', opacity: reveal + flare * 0.35, filter: `brightness(${0.8 + flare * 0.6}) contrast(1.1)`, WebkitMaskImage: 'radial-gradient(circle at 50% 48%, #000 38%, transparent 66%)', maskImage: 'radial-gradient(circle at 50% 48%, #000 38%, transparent 66%)'}}
          />
          {/* 眼睛 */}
          {[0.385, 0.615].map((x) => (
            <div
              key={x}
              style={{
                position: 'absolute',
                left: `${x * 100}%`,
                top: '47.5%',
                width: 18,
                height: 18,
                borderRadius: '50%',
                transform: 'translate(-50%,-50%)',
                background: BLOOD,
                boxShadow: `0 0 ${30 + flare * 90}px ${10 + flare * 30}px ${BLOOD}`,
                opacity: 0.25 + reveal + flare,
              }}
            />
          ))}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: `linear-gradient(transparent 40%, ${INK}ee 85%)`}} />
      {HOOK_WORDS.map((w, i) => {
        const next = HOOK_WORDS[i + 1];
        return (
          <AbsoluteFill key={w.zh} style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: w.size ? 120 : 170}}>
            <RiseText at={lb(w.at)} out={next ? lb(next.at) - 6 : undefined} size={w.size ?? 150} color={w.color} weight={900}>
              {w.zh}
            </RiseText>
            <Latin at={lb(w.at) + 6} out={next ? lb(next.at) - 6 : undefined} text={w.la} size={24} style={{marginTop: 18}} />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

/* ============ 2. 身份：20 张卡在纵深里飞过 → 发 6 张 → 盖牌 ============ */

const DEAL = ['SEER', 'WITCH', 'GUARD', 'VILLAGER', 'WOLF', 'WOLF'];

export const Roles: React.FC = () => {
  const frame = useCurrentFrame();
  const tunnelOut = interpolate(frame, [lb(4.5), lb(5.5)], [1, 0], clamp);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 50%, #1e1612, ${INK} 70%)`, perspective: 1200, overflow: 'hidden'}}>
      {/* 纵深隧道 */}
      <AbsoluteFill style={{transformStyle: 'preserve-3d', opacity: tunnelOut}}>
        {ROLES.map((r, i) => {
          const ang = (i / ROLES.length) * Math.PI * 2 * 2.3 + random(`a${i}`) * 0.6;
          const rad = 620 + random(`r${i}`) * 380;
          const z0 = -5200 + (i / ROLES.length) * 4800;
          const z = z0 + frame * 62;
          const zz = ((z + 5200) % 5600) - 5200;
          const o = interpolate(zz, [-5200, -3800, -200, 300], [0, 1, 1, 0], clamp);
          return (
            <div
              key={r.code}
              style={{
                position: 'absolute',
                left: 960 - 130,
                top: 540 - 195,
                transform: `translate3d(${Math.cos(ang) * rad}px,${Math.sin(ang) * rad * 0.62}px,${zz}px) rotateY(${-Math.cos(ang) * 22}deg) rotateZ(${Math.cos(ang) * 6}deg)`,
                opacity: o,
              }}
            >
              <RoleCard r={r} w={260} />
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{opacity: interpolate(frame, [lb(3.5), lb(4)], [1, 0], clamp), textAlign: 'center', background: `radial-gradient(${INK}dd 30%, transparent 70%)`, padding: '60px 140px'}}>
          <RiseText at={4} size={150} weight={900}>
            二十种身份
          </RiseText>
          <Latin at={12} text="XX ROLES · 自由配局" size={26} style={{marginTop: 14}} />
        </div>
      </AbsoluteFill>
      {/* 发牌 */}
      <AbsoluteFill style={{perspective: 1600}}>
        {DEAL.map((code, i) => {
          const at = lb(4 + i * 0.5);
          const k = useSpring(at, {damping: 17, stiffness: 120});
          const flip = interpolate(frame, [lb(7) + i * 2, lb(7) + i * 2 + 12], [0, 1], {...clamp, easing: easeIO});
          const x = (i - 2.5) * 270;
          const arcY = Math.abs(i - 2.5) * 26;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 960 + x - 120,
                top: 500 + arcY - 180,
                transform: `translate3d(0,${(1 - k) * 700}px,${(1 - k) * -400}px) rotateZ(${(i - 2.5) * 3 + (1 - k) * 30}deg)`,
                opacity: k > 0.01 ? 1 : 0,
              }}
            >
              <FlipCard r={role(code)} k={flip} w={240} glow={code === 'WOLF' ? interpolate(frame, [lb(6), lb(6.5), lb(7)], [0, 1, 0], clamp) : 0} />
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 90}}>
        <RiseText at={lb(6)} size={54} weight={700} spacing="0.3em">
          标准六人局 · 二狼四民
        </RiseText>
        <Latin at={lb(7)} text="身份暗中分配 · DEALT IN SECRET" size={20} style={{marginTop: 10}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============ 3. 开局页：倾斜屏幕 + 抠出来的案卷与名册 ============ */

export const Setup: React.FC = () => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, lb(4)], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 30% 40%, #221815, ${INK} 70%)`, perspective: 1800, overflow: 'hidden'}}>
      <AbsoluteFill style={{transformStyle: 'preserve-3d'}}>
        <Screen src="screen-setup.jpg" w={1500} rot={[8, 24 - t * 8, -2]} pos={[-120 + t * 60, 40, -260]} />
        <Chip src="ui-casefile.jpg" w={330} at={lb(1)} from={[0, 80, -500]} style={{left: 1330, top: 230}} />
        <Chip src="ui-roster.jpg" w={470} at={lb(2)} from={[-60, 80, -500]} style={{left: 140, top: 470}} />
      </AbsoluteFill>
      <div style={{position: 'absolute', left: 140, top: 120}}>
        <RiseText at={4} size={96} weight={900}>
          一键开局
        </RiseText>
        <RiseText at={lb(2)} size={34} weight={500} color={GOLD} spacing="0.2em">
          每个座位，可接入不同的模型
        </RiseText>
      </div>
    </AbsoluteFill>
  );
};

/* ============ 4. 第一夜：3D 圆桌 + 夜间行动逐拍点亮 ============ */

type Act = {at: number; from: number[]; to: number; color: string; who: string; text: string};
const NIGHT: Act[] = [
  {at: 1, from: [5, 6], to: 2, color: BLOOD, who: 'WOLF', text: '狼人 · 袭击 2 号'},
  {at: 2.5, from: [2], to: 1, color: GOLD, who: 'GUARD', text: '守卫 · 守护 1 号'},
  {at: 4, from: [3], to: 2, color: '#8fc49a', who: 'WITCH', text: '女巫 · 解药救下 2 号'},
  {at: 5.5, from: [1], to: 5, color: MOONBLUE, who: 'SEER', text: '预言家 · 查验 5 号 → 狼'},
];

type Geo = {cx: number; cy: number; rx: number; ry: number};
const NG: Geo = {cx: 1090, cy: 630, rx: 540, ry: 220}; // 夜：右移给左侧实录让位
const VG: Geo = {cx: 960, cy: 610, rx: 600, ry: 260};
const at3 = (s: number, spin: number, g: Geo) => seatPos(s, spin, g.cx, g.cy, g.rx, g.ry);

const Table: React.FC<{spin: number; geo: Geo; children?: React.ReactNode; ring?: (s: number) => string | undefined; dead?: number[]; lit?: (s: number) => number}> = ({
  spin,
  geo,
  children,
  ring,
  dead = [],
  lit,
}) => (
  <>
    <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
      <ellipse cx={geo.cx} cy={geo.cy} rx={geo.rx} ry={geo.ry} fill="none" stroke={`${GOLD}30`} strokeWidth={2} />
      <ellipse cx={geo.cx} cy={geo.cy} rx={geo.rx * 0.55} ry={geo.ry * 0.55} fill="none" stroke={`${GOLD}1c`} strokeWidth={1.5} />
    </svg>
    {children}
    {[1, 2, 3, 4, 5, 6].map((s) => {
      const p = at3(s, spin, geo);
      return <SeatDisc key={s} seat={s} x={p.x} y={p.y} scale={p.scale} ring={ring?.(s)} dead={dead.includes(s) ? 1 : 0} lit={lit?.(s)} />;
    })}
  </>
);

const Portrait: React.FC<{code: string; x: number; y: number; at: number; color: string; size?: number}> = ({code, x, y, at, color, size = 120}) => {
  const k = useSpring(at, {damping: 13, stiffness: 160});
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - 130 * k,
        transform: `translate(-50%,-50%) scale(${k})`,
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `3px solid ${color}`,
        boxShadow: `0 0 40px ${color}aa`,
        zIndex: 2000,
      }}
    >
      <Img src={asset(`role-${code}.jpg`)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
    </div>
  );
};

export const Night: React.FC = () => {
  const frame = useCurrentFrame();
  const spin = interpolate(frame, [0, lb(8)], [0.25, -0.15]);
  const calm = interpolate(frame, [lb(6), lb(6.6)], [1, 0], clamp);
  const targetRing = (s: number) => {
    for (const a of [...NIGHT].reverse()) if (frame >= lb(a.at) + 10 && a.to === s) return a.color;
    return undefined;
  };
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 20%, #131c2b, #07080c 70%)`, overflow: 'hidden'}}>
      {/* 月亮 */}
      <div
        style={{
          position: 'absolute',
          right: 220,
          top: 90,
          width: 150,
          height: 150,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, #f1ead8, #b8ae98)',
          boxShadow: '0 0 120px 30px rgba(220,215,200,.25)',
          opacity: interpolate(frame, [0, 20], [0, 0.9], clamp),
        }}
      />
      <Table spin={spin} geo={NG} ring={targetRing} lit={(s) => (targetRing(s) ? 1 : 0)}>
        <div style={{opacity: calm}}>
          {NIGHT.map((a) =>
            a.from.map((f) => {
              const k = interpolate(frame, [lb(a.at) + 4, lb(a.at) + 16], [0, 1], {...clamp, easing: ease});
              return <Arc key={`${a.at}-${f}`} a={at3(f, spin, NG)} b={at3(a.to, spin, NG)} k={k} color={a.color} lift={170} />;
            }),
          )}
          {NIGHT.map((a) =>
            a.from.map((f) => {
              const p = at3(f, spin, NG);
              return <Portrait key={`p${a.at}-${f}`} code={a.who} x={p.x} y={p.y} at={lb(a.at)} color={a.color} />;
            }),
          )}
        </div>
      </Table>
      {/* 左侧“实录”逐条 */}
      <div style={{position: 'absolute', left: 110, top: 150, fontFamily: SERIF, opacity: calm}}>
        <RiseText at={0} size={64} weight={900}>
          第 一 夜
        </RiseText>
        <Latin at={4} text="NOX PRIMA" size={20} style={{marginBottom: 40}} />
        {NIGHT.map((a) => (
          <RiseText key={a.at} at={lb(a.at) + 2} size={30} weight={500} color={a.color} spacing="0.12em" style={{marginBottom: 14}}>
            {a.text}
          </RiseText>
        ))}
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', paddingBottom: 60}}>
        <RiseText at={lb(6.5)} size={180} weight={900} spacing="0.2em">
          平安夜
        </RiseText>
        <Latin at={lb(6.5) + 8} text="NO ONE DIED" size={26} style={{marginTop: 16}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============ 5. 白天：真发言 → 对跳 ============ */

const Speech: React.FC<{seat: number; code: string; text: string; hl: [number, number, string][]; at: number; side: 'l' | 'r'; liar?: boolean}> = ({
  seat,
  code,
  text,
  hl,
  at,
  side,
  liar,
}) => {
  const frame = useCurrentFrame();
  const k = useSpring(at, {damping: 18, stiffness: 120});
  // 悍跳狼：头像偶尔闪回狼人原图
  const glitch = liar && frame > at + 30 && (Math.floor(frame / 3) % 9 === 0 || (frame > at + 50 && Math.floor(frame / 2) % 7 === 0));
  const x = side === 'l' ? 150 : 1920 - 150 - 1240;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: 250,
        width: 1240,
        display: 'flex',
        flexDirection: side === 'l' ? 'row' : 'row-reverse',
        gap: 60,
        alignItems: 'center',
        opacity: k,
        transform: `translateX(${(1 - k) * (side === 'l' ? -120 : 120)}px)`,
      }}
    >
      <div style={{position: 'relative', flexShrink: 0}}>
        <div style={{width: 380, height: 380, overflow: 'hidden', border: `2px solid ${glitch ? BLOOD : GOLD}88`, boxShadow: `0 30px 80px rgba(0,0,0,.7)`}}>
          <Img
            src={asset(`role-${glitch ? 'WOLF' : code}.jpg`)}
            style={{width: '100%', height: '100%', filter: glitch ? 'hue-rotate(-20deg) saturate(1.6) contrast(1.2)' : undefined, transform: glitch ? `translateX(${(random(frame) - 0.5) * 30}px)` : undefined}}
          />
        </div>
        <div style={{fontFamily: SERIF, fontSize: 20, letterSpacing: '0.4em', color: GOLD, marginTop: 18, textAlign: 'center'}}>座 {String(seat).padStart(2, '0')} · 自称预言家</div>
      </div>
      <div style={{textAlign: side === 'l' ? 'left' : 'right'}}>
        <div style={{fontFamily: SERIF, fontSize: 120, color: `${GOLD}55`, lineHeight: 0.6, height: 60}}>“</div>
        <Typed at={at + 8} text={text} size={56} cps={0.9} hl={hl} />
      </div>
    </div>
  );
};

export const Day: React.FC = () => {
  const frame = useCurrentFrame();
  const aOut = interpolate(frame, [lb(4) - 8, lb(4)], [1, 0], clamp);
  const bOut = interpolate(frame, [lb(8) - 8, lb(8)], [1, 0], clamp);
  const face = useSpring(lb(8), {damping: 14, stiffness: 150});
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 30%, #2a1f17, ${INK} 70%)`, perspective: 1800, overflow: 'hidden'}}>
      {/* 背景：真实对局页，虚化倾斜，证明这是真界面 */}
      <AbsoluteFill style={{transformStyle: 'preserve-3d', opacity: 0.22, filter: 'blur(3px)'}}>
        <Screen src="screen-day.jpg" w={1900} rot={[10, -12 + frame * 0.03, 0]} pos={[0, 60, -700]} />
      </AbsoluteFill>
      <div style={{position: 'absolute', left: 110, top: 80}}>
        <RiseText at={0} size={44} weight={700} spacing="0.4em" color={GOLD}>
          第 一 天 · 白昼发言
        </RiseText>
      </div>
      <div style={{opacity: aOut}}>
        <Speech seat={1} code="SEER" side="l" at={4} text="我是预言家，昨晚验了5号，查杀！今天全票出5号。" hl={[[13, 16, GOLD]]} />
      </div>
      <div style={{opacity: bOut}}>
        <Speech seat={5} code="SEER" side="r" liar at={lb(4)} text="笑死，我才是真预言家，昨晚验的1号就是狼！" hl={[[3, 10, BLOOD]]} />
      </div>
      {/* 对跳：两张头像对峙 */}
      <AbsoluteFill style={{opacity: Math.min(1, face * 1.3)}}>
        {[
          {code: 'SEER', seat: 1, x: 330 - (1 - face) * 300, c: GOLD},
          {code: 'SEER', seat: 5, x: 1590 + (1 - face) * 300, c: BLOOD},
        ].map((p, i) => (
          <div key={i} style={{position: 'absolute', left: p.x, top: 540, transform: 'translate(-50%,-50%)', textAlign: 'center'}}>
            <div style={{width: 420, height: 420, overflow: 'hidden', border: `2px solid ${p.c}`, boxShadow: `0 0 90px ${p.c}55`}}>
              <Img
                src={asset(`role-${i === 1 && Math.floor(frame / 4) % 6 === 0 ? 'WOLF' : p.code}.jpg`)}
                style={{width: '100%', height: '100%', transform: i === 1 ? 'scaleX(-1)' : undefined}}
              />
            </div>
            <div style={{fontFamily: SERIF, fontSize: 30, letterSpacing: '0.4em', color: p.c, marginTop: 22}}>座 0{p.seat}</div>
          </div>
        ))}
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
          <RiseText at={lb(8)} size={230} weight={900} spacing="0.15em">
            对跳
          </RiseText>
          <Latin at={lb(8) + 6} text="TWO SEERS · ONE LIES" size={26} style={{marginTop: 10}} />
          <RiseText at={lb(10)} size={34} weight={500} color={DIM} spacing="0.15em" style={{marginTop: 40}}>
            谁在说谎，由其余四个 AI 投票裁决
          </RiseText>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============ 6. 投票：连线 → 4 : 2 → 出局 ============ */

const VOTES: [number, number][] = [
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 1],
  [6, 1],
];

export const Vote: React.FC = () => {
  const frame = useCurrentFrame();
  const spin = interpolate(frame, [0, lb(8)], [-0.1, 0.2]);
  const tally = (t: number) => VOTES.filter(([, to], i) => to === t && frame >= lb(i * 0.5) + 8).length;
  const big = useSpring(lb(4), {damping: 12, stiffness: 180});
  const out = frame >= lb(5.5);
  const tableDim = interpolate(frame, [lb(4) - 4, lb(4) + 6], [1, 0.35], clamp);
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 60%, #1f1613, ${INK} 70%)`, overflow: 'hidden'}}>
      <div style={{opacity: tableDim}}>
        <Table spin={spin} geo={VG} dead={out ? [5] : []} ring={(s) => (s === 5 && tally(5) > 0 ? BLOOD : s === 1 && tally(1) > 0 ? GOLD : undefined)}>
          {VOTES.map(([a, b], i) => {
            const k = interpolate(frame, [lb(i * 0.5), lb(i * 0.5) + 12], [0, 1], {...clamp, easing: ease});
            return <Arc key={i} a={at3(a, spin, VG)} b={at3(b, spin, VG)} k={k} color={b === 5 ? BONE : `${GOLD}`} lift={60} width={2.5} />;
          })}
        </Table>
      </div>
      <div style={{position: 'absolute', left: 110, top: 80}}>
        <RiseText at={0} size={44} weight={700} spacing="0.4em" color={GOLD}>
          放 逐 投 票
        </RiseText>
      </div>
      {/* 右侧计票 */}
      <div style={{position: 'absolute', right: 130, top: 90, fontFamily: SERIF, opacity: tableDim}}>
        {[5, 1].map((t) => (
          <div key={t} style={{display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18}}>
            <span style={{fontSize: 28, color: BONE, letterSpacing: '0.2em', width: 110}}>{t} 号</span>
            <div style={{width: 60 * tally(t), height: 14, background: t === 5 ? BLOOD : GOLD, transition: 'none'}} />
            <span style={{fontSize: 30, color: BONE}}>{tally(t)}</span>
          </div>
        ))}
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: Math.min(1, big * 1.5)}}>
        <div style={{fontFamily: SERIF, fontSize: 320, fontWeight: 900, color: BONE, letterSpacing: '0.1em', transform: `scale(${1.6 - big * 0.6})`, lineHeight: 1}}>
          4 <span style={{color: GOLD}}>:</span> 2
        </div>
        <div style={{marginTop: 30, opacity: out ? 1 : 0, transform: `scale(${out ? interpolate(frame, [lb(5.5), lb(5.5) + 6], [1.6, 1], clamp) : 1.6})`}}>
          <span style={{fontFamily: SERIF, fontSize: 60, color: BLOOD, border: `4px solid ${BLOOD}`, padding: '6px 34px', letterSpacing: '0.4em', fontWeight: 900}}>
            5 号出局
          </span>
        </div>
        <div style={{marginTop: 50}}>
          <Typed at={lb(6)} text="遗言：出我可以，但 1 号绝对是狼。" size={32} cps={1.1} style={{color: DIM}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============ 7. 揭晓：六张牌翻开 → 真实结算幕布 ============ */

export const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  const curtain = useSpring(lb(2), {damping: 16, stiffness: 110});
  const cardsDim = interpolate(frame, [lb(2), lb(2.5)], [1, 0.3], clamp);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 50%, #2a2116, ${INK} 70%)`, perspective: 1600, overflow: 'hidden'}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 70, textAlign: 'center', opacity: cardsDim}}>
        <Latin at={0} text="第二夜 · 女巫毒倒最后一只狼" size={28} color={BONE} style={{letterSpacing: '0.3em'}} />
      </div>
      <div style={{opacity: cardsDim, filter: `blur(${(1 - cardsDim) * 6}px)`}}>
        {[1, 2, 3, 4, 5, 6].map((s, i) => {
          const flip = interpolate(frame, [i * 3, i * 3 + 12], [0, 1], {...clamp, easing: easeIO});
          const code = SEATS[s];
          return (
            <div key={s} style={{position: 'absolute', left: 960 + (i - 2.5) * 280 - 120, top: 200, textAlign: 'center'}}>
              <FlipCard r={role(code)} k={flip} w={240} backFirst glow={code === 'WOLF' ? flip : 0} />
              <div style={{fontFamily: SERIF, fontSize: 24, color: code === 'WOLF' ? BLOOD : GOLD, letterSpacing: '0.3em', marginTop: 20}}>座 0{s}</div>
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            opacity: curtain,
            transform: `translateY(${(1 - curtain) * 80}px) scale(${0.9 + curtain * 0.1})`,
            boxShadow: `0 0 ${200 * curtain}px ${GOLD}33, 0 50px 120px rgba(0,0,0,.8)`,
          }}
        >
          <Img src={asset('ui-verdict.jpg')} style={{width: 1000, display: 'block', border: `1px solid ${GOLD}55`}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============ 8. 卷宗：整页复盘在 3D 里滚过 ============ */

export const Archive: React.FC = () => {
  const frame = useCurrentFrame();
  const sc = interpolate(frame, [0, lb(4)], [0.02, 0.4], {...clamp, easing: easeIO});
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 70% 50%, #211813, ${INK} 70%)`, perspective: 1500, overflow: 'hidden'}}>
      <AbsoluteFill style={{transformStyle: 'preserve-3d'}}>
        <Screen src="screen-detail.jpg" w={1300} crop={1300 / 1500} scroll={sc} rot={[28, -18, 6]} pos={[330, 40, -200]} style={{boxShadow: '0 80px 160px rgba(0,0,0,.85)'}} />
      </AbsoluteFill>
      <div style={{position: 'absolute', left: 130, top: 330}}>
        <RiseText at={4} size={110} weight={900}>
          每一局
        </RiseText>
        <RiseText at={lb(1)} size={110} weight={900} color={GOLD}>
          都存成卷宗
        </RiseText>
        <Latin at={lb(1.5)} text="逐句发言 · 每张票 · 可复盘" size={26} color={BONE} style={{marginTop: 26, letterSpacing: '0.3em'}} />
      </div>
    </AbsoluteFill>
  );
};

/* ============ 9. 片尾 ============ */

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useSpring(0, {damping: 12, stiffness: 120});
  const end = interpolate(frame, [lb(10) - 20, lb(10)], [1, 0], clamp);
  return (
    <AbsoluteFill style={{background: INK, alignItems: 'center', justifyContent: 'center', opacity: end}}>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 38%, ${BLOOD}33, transparent 45%)`}} />
      <Img src={asset('mark.png')} style={{width: 190, borderRadius: '50%', transform: `scale(${0.6 + k * 0.4})`, opacity: k, boxShadow: `0 0 120px ${BLOOD}66`}} />
      <div style={{height: 40}} />
      <RiseText at={6} size={128} weight={900} spacing="0.2em">
        月夜狼人杀
      </RiseText>
      <Latin at={14} text="MOONLIT INQUEST" size={28} style={{marginTop: 12}} />
      <RiseText at={lb(2)} size={40} weight={500} color={BONE} spacing="0.5em" style={{marginTop: 40}}>
        月夜之审 · <span style={{color: BLOOD}}>谁</span>人为狼
      </RiseText>
      <div style={{marginTop: 60, fontFamily: SERIF, fontSize: 28, color: DIM, letterSpacing: '0.12em', opacity: interpolate(frame, [lb(3), lb(3) + 12], [0, 1], clamp)}}>
        github.com/Dr-Ai-0018/wolfai-killer
      </div>
      <div style={{position: 'absolute', bottom: 50, fontFamily: SERIF, fontSize: 18, color: '#5d554b', letterSpacing: '0.2em', opacity: interpolate(frame, [lb(3), lb(3) + 12], [0, 1], clamp)}}>
        画面为真实界面截图与项目原有美术 · 演示对局台词由预设剧本驱动
      </div>
    </AbsoluteFill>
  );
};

