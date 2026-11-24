import type { ModelKind } from '../entities/soldier';

export interface CharacterDossier {
  id: string;
  callsign: string;
  name: string;
  en: string;
  role: string;
  faction: string;
  factionTag: 'ally' | 'hostile' | 'civilian';
  modelKind: ModelKind;
  weapon: string;
  specialty: string;
  status: string;
  quote: string;
  bio: string;
  gearNotes: string[];
}

export interface FactionDossier {
  id: string;
  code: string;
  name: string;
  en: string;
  alignment: '友方作战力量' | '敌对武装势力' | '受保护民用单位';
  alignKey: 'ally' | 'hostile' | 'civilian';
  emblem: string;
  hq: string;
  strength: string;
  doctrine: string;
  summary: string;
  keyOps: string[];
  assets: string[];
}

export const CHARACTER_DOSSIERS: CharacterDossier[] = [
  {
    id: 'gao',
    callsign: '洞幺 · BLADE-1',
    name: '高远（老高）',
    en: 'SGT. MAJ. GAO YUAN',
    role: '「利刃」一分队 队长 / 战术指挥官',
    faction: '海军陆战队 · 「利刃」特战一分队',
    factionTag: 'ally',
    modelKind: 'marine_lead',
    weapon: '定制消音 QBZ-192 突击步枪 / 加密双频战术电台',
    specialty: '海陆两栖强袭指挥 · 室内近战破门协同 · 交叉火力调度',
    status: '现役 · 作战指挥',
    quote: '“跟紧队形！只要我老高还站着，咱们四个一个都不会掉队。”',
    bio: '服役十四年的海军陆战队王牌分队长，曾多次执行亚丁湾护航反海盗与高危人质营救任务。在“深海利刃”行动中率队顶着十二级台风索降泰山号，随后又带队万里奔袭中亚戈壁摧毁厄普西隆地下中继站。沉稳果决，永远把最危险的突入位留给自己。',
    gearNotes: [
      '专属指挥官防弹插板胸挂 + 金色分队长徽章',
      '双频 PRC-152 加密电台背包 + 长鞭卫星通信天线',
      '半包围青色战术护目镜 + 骨传导抗噪耳机与麦克风',
      '左肩高流明战术照明灯 + 顶置青色敌我识别频闪灯',
    ],
  },
  {
    id: 'tiechui',
    callsign: '洞二 · BLADE-2',
    name: '周铁（铁锤）',
    en: 'SSGT. ZHOU TIE',
    role: '重装突击手 / 爆破破门专家',
    faction: '海军陆战队 · 「利刃」特战一分队',
    factionTag: 'ally',
    modelKind: 'marine_heavy',
    weapon: '重型班用机枪 / C4 破门炸药与高爆震撼弹',
    specialty: '重火力压制 · 攻坚破门 · 战地弹药补给支援',
    status: '现役 · 重装前锋',
    quote: '“躲在掩体后头算什么本事？吃铁锤爷爷一梭子！打完这仗我请全队吃涮羊肉！”',
    bio: '分队里的重装猛男与开心果，人如其名，无论多厚的水密防爆闸或防空阵地，在他手里的 C4 和重机枪面前都不堪一击。性格豪爽热血，在激战中总能以狂暴火力为队友撕开突破口，还会随时从背囊里分出备用弹匣和手雷支援主角。',
    gearNotes: [
      '全封闭海军陆战重装加压 EOD 防爆护甲与胸控模块',
      '高强度镜面鎏金防弹全面罩头盔 + 顶置青色敌我频闪灯',
      '加厚防破片护膝、重型双大腿弹药挂袋与生命维持背囊',
      '全天候防爆破门与重机枪压制专用抗冲击护具',
    ],
  },
  {
    id: 'player',
    callsign: '洞三 · BLADE-3（主角）',
    name: '林峰',
    en: 'LT. LIN FENG',
    role: '精锐尖兵 / 全地形特战突击手',
    faction: '海军陆战队 · 「利刃」特战一分队',
    factionTag: 'ally',
    modelKind: 'marine_player',
    weapon: '全模块化 QBZ-192 / M4A1 / AWM 狙击步枪 / QSZ-193 手枪',
    specialty: '全武器精通 · 潜行暗杀 · 斩首 BOSS · 极限反应射击',
    status: '现役 · 行动核心',
    quote: '“任务目标确认。交给我——一个不留。”',
    bio: '由铁砧营地以历史第一名成绩破格提拔进入「利刃」一分队的王牌尖兵，也是玩家亲自扮演的核心角色。曾在反恐排爆中重伤换装军用钛碳合金仿生机械左臂与左腿，此后凭超凡稳定控枪屡次在绝境中力挽狂澜。',
    gearNotes: [
      '军用钛碳青合金仿生机械左臂与高机动仿生左腿',
      '暗夜炭黑拉链特战夹克 + 全身战术肩带与多联弹匣腰带',
      '低轮廓模块化突击背囊与青色敌我荧光识别棒',
      '高抓地力全地形战术靴与护膝装甲组件',
    ],
  },
  {
    id: 'bailing',
    callsign: '洞四 · BLADE-4',
    name: '沈灵（百灵）',
    en: 'SGT. SHEN LING',
    role: '电子战与情报破译专家 / 侧翼狙击掩护',
    faction: '海军陆战队 · 「利刃」特战一分队',
    factionTag: 'ally',
    modelKind: 'marine_tech',
    weapon: '紧凑型 QBZ-192 步枪 / 便携卫星电子战终端',
    specialty: '军用加密破解 · 舰船与油田电网接管 · 实时无线电监听',
    status: '现役 · 电子战支援',
    quote: '“信号锁死了！给我十八秒，我把厄普西隆的底层密钥连根拔起！”',
    bio: '国防科技体系顶尖电子对抗天才，思维敏捷、语速清脆。身穿轻量化女性贴身暗夜碳纤维电子战潜行服，在泰山号三号主货舱与戈壁地下超算机房屡次破译敌方加密载荷，是分队最可靠的“千里眼与顺风耳”。',
    gearNotes: [
      '女性专属轻量化深蓝黑碳纤维贴身电子战潜行服',
      '右侧单目全息 AR 战术目镜 + 骨传导耳麦',
      '胸前翻折式军用加固发光加密平板电脑',
      '双天线折叠卫星电子战终端背包 + 绿色链路状态灯',
    ],
  },
  {
    id: 'boss_kronos',
    callsign: 'BOSS · KRONOS',
    name: '「铁锚」克洛诺斯',
    en: 'IRON ANCHOR · KRONOS',
    role: '第一关终局 BOSS · 泰山号船艏重甲处刑者',
    faction: '厄普西隆（Epsilon）国际佣兵集团',
    factionTag: 'hostile',
    modelKind: 'boss_kronos',
    weapon: '四管旋转重型加特林机炮 / 船用高爆震撼榴弹',
    specialty: '压迫式重火力推进 · 50% 血量红光过载 · 高爆榴弹齐射',
    status: '极度危险 · 船艏镇守',
    quote: '“想坐直升机离开泰山号？先问问我手里这四根烧红的枪管！”',
    bio: '厄普西隆在秘密远洋船厂锻造的巨型重装战舰处刑机甲，由前东欧特种重甲教官驾驶。2.4 米巨躯身披厚重焊接舰艇装甲钢板，胸口嵌入猩红核能反应炉，半血过载时全身核心炽红狂暴，是泰山号船艏停机坪最致命的噩梦。',
    gearNotes: [
      '2.4 米重型舰艇焊接氧化钢板全覆式巨神兵机甲躯体',
      '胸口巨型内置猩红反应堆核心与双眼红外扫描阵列',
      '超厚重液压双臂与防爆级重装关节护甲',
      '四管旋转重型加特林机炮（铜箍高转速散热枪管）',
    ],
  },
  {
    id: 'boss_viper',
    callsign: 'BOSS · VIPER',
    name: '指挥官 · 毒蛇',
    en: 'COMMANDER VIPER',
    role: '第二关终局 BOSS · 厄普西隆战区总指挥',
    faction: '厄普西隆（Epsilon）国际佣兵集团',
    factionTag: 'hostile',
    modelKind: 'boss_viper',
    weapon: '电磁脉冲高能连狙 / 双肩六联微型导弹巢',
    specialty: '高频战术翻滚规避 · 精准致命点射 · 双肩微型导弹齐射',
    status: '极度危险 · 戈壁中继塔决战',
    quote: '“我筹备了三年的卫星反制计划绝不能毁在你们手里——全部给我葬身戈壁！”',
    bio: '劫持泰山号与控制喀拉干达 7 号油田的幕后武装总指挥，冷酷傲慢、手段狠辣。在泰山号企图沉船灭口失败后，退守中亚戈壁悬崖卫星站并亲自穿戴碳纤维隐身外骨骼迎战「利刃」一分队。极度敏捷，会连续翻滚拉扯并发射双肩微型导弹。',
    gearNotes: [
      '沙漠碳纤维流线隐身外骨骼胸甲与背部稳定翼',
      '双肩高位折叠式六联微型高爆导弹发射巢',
      '冷酷猩红双目斜切式猎杀全覆面甲',
      '双轨电磁脉冲高能精确射手步枪',
    ],
  },
  {
    id: 'boss_tyrant',
    callsign: 'BOSS · TYRANT',
    name: '「赤沙暴君」哈迪尔首领',
    en: 'RED SAND TYRANT',
    role: '哈迪尔防线 BOSS · 第 3/6/9…波压轴霸主',
    faction: '哈迪尔武装叛军',
    factionTag: 'hostile',
    modelKind: 'boss_tyrant',
    weapon: '黑金重型爆破突击火炮 / 高压燃料爆裂弹',
    specialty: '超高护甲血量 · 熔炉过载狂暴 · 击败必获总部特级支援',
    status: '极度危险 · 周期突袭',
    quote: '“这片赤红荒漠吞噬过无数入侵者，今天轮到你们了！”',
    bio: '盘踞边境小镇哈迪尔的极端武装最高统帅，凭借走私军火拼装出骇人的黑金红三色重型反应装甲。每当防线坚持到第 3 的倍数波次，他便会亲率死士强行压阵；唯有善用战区总部空投的战术支援并集火击溃其重甲，方能解锁特级司令部装备空投。',
    gearNotes: [
      '鎏金弯月双角重甲战神头盔与多层漆红叠片防弹胸甲',
      '黑金猩红大袖叠片重型肩甲、裙甲与重装胫甲',
      '超高护甲韧性与半血狂暴熔炉过载状态',
      '重型黑金爆破突击炮（附带炽焰过热散热槽与金色制退器）',
    ],
  },
  {
    id: 'captain',
    callsign: 'CIVILIAN · CAPTAIN',
    name: '陈国海（老船长）',
    en: 'CAPT. CHEN GUOHAI',
    role: '泰山号万吨远洋货轮 船长',
    faction: '泰山号远洋商船队',
    factionTag: 'civilian',
    modelKind: 'hostage_captain',
    weapon: '无武装（民用船员）',
    specialty: '远洋航线领航 · 掌握厄普西隆非法货柜舱单线索',
    status: '第一关营救目标',
    quote: '“我们泰山号跑了二十年远洋，从没见过这么狠的武装分子。你们一定要活着回来啊！”',
    bio: '拥有三十年远洋航行经验的老船长。在泰山号遭毒蛇武装劫持时，宁死不交出主货舱密匙并偷偷记下了“厄普西隆”红色危险集装箱的编号。被押在二楼船员大餐厅后由「利刃」一分队双门闪光破门成功营救，成为揭开跨国阴谋的关键证人。',
    gearNotes: [
      '远洋商船船长制服与白色制式大檐帽',
      '随身携带三楼舰桥航运加密日志与舱单索引',
    ],
  },
];

export const FACTION_DOSSIERS: FactionDossier[] = [
  {
    id: 'blade_squad',
    code: 'UNIT-01 // PLA-MC',
    name: '海军陆战队 · 「利刃」特战一分队',
    en: 'PLA MARINE CORPS · BLADE SQUAD-1',
    alignment: '友方作战力量',
    alignKey: 'ally',
    emblem: '⚔',
    hq: '南海某两栖特战基地 / 铁砧营地前进考核站',
    strength: '4 人精锐尖刀班（洞幺老高 · 洞二铁锤 · 洞三林峰 · 洞四百灵）',
    doctrine: '全域快反 · 立体突入 · 零人质伤亡 · 精准斩首',
    summary: '直属两栖特战旅的王牌应急处突小队，专职处理远海反劫持、跨境反恐与高危战略设施拔点任务。队员间历经生死磨合，具备极高的自主协同交火与掩护推进能力，配属“海雕-1”直-20J 舰载突击直升机提供远程投送与火力接应。',
    keyOps: [
      '「铁砧考核」：新兵实弹靶场、手雷投掷与 CQB 突入屋零误伤认证',
      '「深海利刃」：十二级台风夜强袭泰山号，营救 6 名船员并击毙铁锚·克洛诺斯',
      '「戈壁炼狱」：奔袭喀拉干达 7 号油田，捣毁地下超算中心并斩首指挥官·毒蛇',
    ],
    assets: ['QBZ-192 模块化短突击步枪', 'QSZ-193 战术手枪', 'GPNVG-18 全景夜视仪', 'Z-20J “海雕-1”突击直升机'],
  },
  {
    id: 'command_net',
    code: 'CMD-02 // STRATEGIC',
    name: '远洋护航编队 & 西北战略通讯所',
    en: 'FLEET COMMAND & NW INTEL RELAY',
    alignment: '友方作战力量',
    alignKey: 'ally',
    emblem: '◎',
    hq: '南海机动编队旗舰（DDG-173） / 西北腹地监听站',
    strength: '舰载航空兵、战略电子侦察网与情报分析团队（云茹）',
    doctrine: '全频段电子支援 · 实时战场态势感知 · 远程接应护航',
    summary: '为「利刃」一分队提供顶层情报链路与战略支援的幕后中枢。南海编队驱逐舰在暴雨夜为泰山号外围封控并打亮远海探照灯；西北通讯所情报官云茹则全程监控厄普西隆的高轨卫星信号，在关键时刻为前线指引每一座爆破点与撤离航线。',
    keyOps: [
      '锁定泰山号失联 AIS 信号并协调“海雕-1”实施强风索降',
      '逆向追踪“厄普西隆”加密芯片流向，定位中亚喀拉干达 7 号油田',
    ],
    assets: ['052D 型驱逐舰外海警戒网', '高轨加密通信中继', '多光谱雷达态势感知系统'],
  },
  {
    id: 'epsilon_pmc',
    code: 'THREAT-01 // HOSTILE',
    name: '厄普西隆（Epsilon）国际佣兵集团',
    en: 'EPSILON PRIVATE MILITARY SYNDICATE',
    alignment: '敌对武装势力',
    alignKey: 'hostile',
    emblem: '▼',
    hq: '中亚喀拉干达 7 号油田地下掩体（已摧毁）',
    strength: '逾千名跨国退役特种雇佣兵、重装防暴部队与外骨骼处刑者',
    doctrine: '不对称科技奇袭 · 挟持人质 · 焦土灭口 · 卫星电子劫持',
    summary: '资金雄厚、装备极度精良的地下跨国私营军事财团，以猩红色战术目镜与臂章为标识。他们企图利用走私的军用级干扰载荷配合中亚地下超算机房，向高轨通信卫星注入恶意反制指令。成员包含暗哨狙击手、防暴盾牌突破手、重装机枪手，以及克洛诺斯与毒蛇等外骨骼 BOSS。',
    keyOps: [
      '秘密劫持万吨货轮泰山号，企图借远洋商船掩护偷运“厄普西隆”核心载荷',
      '占领喀拉干达 7 号油田并改建为带防爆闸、地下超算机房与巨型卫星天线的军事堡垒',
    ],
    assets: ['重型防爆外骨骼（克洛诺斯 / 毒蛇）', '四联装防空导弹阵地', '军用级地下超算矩阵', 'Ka 波段高轨中继天线'],
  },
  {
    id: 'hadir_rebels',
    code: 'THREAT-02 // HADIR',
    name: '哈迪尔武装叛军 · 赤沙军团',
    en: 'HADIR INSURGENT LEGION',
    alignment: '敌对武装势力',
    alignKey: 'hostile',
    emblem: '✹',
    hq: '边境废墟小镇 · 哈迪尔（Hadir）',
    strength: '源源不断的波次突击集群与重装“赤沙暴君”督战队',
    doctrine: '人海波次消耗 · 巷战包抄 · 重甲首领周期压阵',
    summary: '活跃在荒漠边境城镇哈迪尔的极端武装组织，长期为厄普西隆提供黑市通道与外围掩护。在哈迪尔防线守卫战中，他们会以不断升级的多兵种混合波次猛攻前进基地，每三波更会派出黑金重甲首领「赤沙暴君」亲自碾压防线。',
    keyOps: [
      '持续围攻边境前进基地，企图夺取战略补给枢纽',
      '每三波出动重甲「赤沙暴君」强袭防线',
    ],
    assets: ['黑金反应装甲外骨骼', '重型爆破突击炮', '多兵种混合巷战波次集群'],
  },
  {
    id: 'taishan_crew',
    code: 'CIV-01 // PROTECTED',
    name: '泰山号万吨远洋商船队',
    en: 'M/V TAISHAN MERCHANT MARINE',
    alignment: '受保护民用单位',
    alignKey: 'civilian',
    emblem: '⚓',
    hq: '南海国际航运主干道 · M/V TAISHAN（276m × 40m）',
    strength: '老船长陈国海与 5 名留守中国籍远洋船员',
    doctrine: '民用远洋集装箱货运 · 危机中坚守职责保护船体',
    summary: '排水量逾十万吨的大型远洋集装箱货轮，拥有四层舰桥上层建筑（地下冷库与铺位、宿舍与公共卫生间、船员大餐厅与商业不锈钢后厨、全景舰桥）、14 米深双层主货舱与双机 18 米柴油轮机舱。遭劫持后全体船员表现英勇，最终被「利刃」一分队安全救出。',
    keyOps: [
      '暗中锁定轮机舱与舰桥舱单线索，协助特战队识破厄普西隆阴谋',
    ],
    assets: ['276m 远洋集装箱船体', '双机 18m 十二缸船用柴油主机', '双 18m 重型甲板龙门吊'],
  },
];
