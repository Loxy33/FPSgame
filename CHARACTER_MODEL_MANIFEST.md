# 《赤沙行动 (Operation Red Sand)》敌我全角色 3D 模型重做清单与 AI 生成提示词规范

本文档专为 **3D 生成大模型（Tripo3D / Meshy / Rodin Gen-1.5 / 混元 3D / CSM）** 或外部 3D 美术管线编写。
每个角色均提供：**引擎对接文件名**、**体型与设计规范**、**可直接复制的中文生成提示词（CN Prompt）** 与 **英文生成提示词（EN Prompt）**。

---

## 一、全局 3D 生成与引擎对接技术规范（必读）

向 3D 生成模型提交任务时，请统一遵循以下约束，以确保导入引擎后与现有的 24 骨骼程序化 IK 持枪、战术翻滚、蹲伏、受击和死亡动画完美兼容：

1. **标准姿态（Pose）**：**标准 A-Pose 或 T-Pose，双手自然张开且手中不要握持任何武器**（极其重要：游戏引擎会通过骨骼 IK 自动把独立的 3D 步枪/机枪/手枪绑定到角色双手中；若模型手里自带粘连的枪，会导致双枪重叠）。
2. **输出格式与贴图**：
   - 文件格式：`.glb`（glTF 2.0 二进制）或 `.fbx`（导出后可由本地 Blender 自动转 `.glb`）。
   - 材质贴图：`2048×2048` PBR 贴图（`BaseColor` 基础色、`Normal` 法线、`MetallicRoughness` 金属粗糙度；BOSS 可选配 `Emissive` 自发光贴图）。
   - 画风要求：**写实 3A 现代军事战术风格（Call of Duty: Modern Warfare / Battlefield 写实 PBR 质感）**，严禁卡通/Q版/低多边形（Low-Poly）风格。
3. **尺寸与朝向**：
   - 比例：`1 单位 = 1 米`，脚底踩在原点平面 `Y = 0`。
   - 常规人类身高：`1.75m ~ 1.88m`（女性约 `1.68m ~ 1.72m`，重装兵约 `1.92m`，BOSS 约 `2.0m ~ 2.25m`）。
4. **骨骼绑定（Rigging）**：
   - 若生成平台支持自动绑骨（Auto-Rig），选择 **Standard Humanoid（标准人形骨骼 / Mixamo 兼容 24 骨骼）** 即可。
   - 若仅生成静态白模/带贴图网格（Unrigged Mesh），直接放入工程即可——本地 Blender 4.2 脚本可一键自动完成 24 骨骼权重传递与绑定。

---

## 二、我方核心主角团：「利刃」特战一分队（4 套独立英雄模型）

> **设计原则**：四人必须拥有**完全不同的头盔/头部特征、胸挂护甲轮廓、背包天线与体型比例**，一眼即可在战场上和档案 3D 检视台中分辨。

### 1. 洞幺 · 高远（老高）—— 分队长 / 战术指挥官
- **目标文件名**：`hero_gao.glb`（替换原 `marine_lead`）
- **体型与气质**：身高 `1.83m`，标准精悍老兵体型；沉稳干练的 38 岁中国特种部队指挥官。
- **核心外观特征**：
  - 头部：海军陆战队高切 FAST 战术头盔 + 半包围战术防风护目镜 + 骨传导降噪耳机与唇边麦克风。
  - 躯干：深海蓝灰数码迷彩蛙服 + 指挥官重型模块化防弹插板背心（胸口带战术电台 PTT 开关与金色分队长徽章）。
  - 背部：军用双频加密战术电台背包，左后肩竖立一根细长鞭状通信天线。
  - 下肢：战术护膝工装裤 + 高帮防水作战靴。
- **中文 3D 生成提示词（CN Prompt）**：
  > 写实3A军事游戏角色，中国海军陆战队特种部队分队长，38岁沉稳男性老兵，全身A-pose站立，双手空手无武器。头戴高切战术头盔、战术防风护目镜、降噪通讯耳机和麦克风；身穿深海蓝灰数码迷彩战术蛙服，胸前穿戴模块化防弹插板背心、对讲机肩咪与弹匣包，背后背着带长天线的军用加密无线电通信背包；腿部有硬壳战术护膝和黑色高帮作战靴。现代军事写实PBR材质，高细节布料褶皱与凯夫拉纹理，8K级次世代游戏建模。
- **英文 3D 生成提示词（EN Prompt）**：
  > Realistic AAA military game character, elite PLA Marine Corps special forces squad leader, veteran male operator, full body A-pose, empty hands, unarmed. Wearing high-cut tactical FAST helmet with ballistic goggles, Peltor comms headset with boom mic, dark navy-grey digital camo combat shirt and cargo pants, heavy modular plate carrier vest with radio PTT and mag pouches, military PRC tactical radio backpack with whip antenna, hard knee pads and combat boots. Photorealistic Call of Duty Modern Warfare style, gritty matte PBR textures, clean symmetrical topology.

---

### 2. 洞二 · 周铁（铁锤）—— 重装突击手 / 爆破破门专家
- **目标文件名**：`hero_tiechui.glb`（对应 `marine_heavy`）
- **体型与气质**：身高 `1.90m`，魁梧壮硕的重装猛男体型（比普通士兵宽一圈）。
- **核心外观特征**：
  - 头部：重型防爆全防护头盔（带可翻折防弹面罩或装甲护颌 + 双目夜视仪支架）。
  - 躯干：加厚防弹护颈（Gorget）+ 重型全覆盖防爆防弹胸甲 + 左右双层重型防破片肩甲（Pauldrons），胸前与腰部挂载四联机枪弹箱包与 C4 破门炸药包。
  - 背部：大容量重装供弹与破门工具背囊（外挂破门锤或双联弹鼓盒）。
  - 下肢：加厚防爆护腿板、重型护膝与钢头重装战靴。
- **中文 3D 生成提示词（CN Prompt）**：
  > 写实3A军事游戏角色，特种部队重装爆破突击手，身材魁梧壮硕，全身A-pose站立，双手空手无武器。头戴带防弹下颌护甲与防爆面罩的重型战术头盔；脖子有加高防弹护颈，身穿深灰与暗蓝重型全覆盖防爆防弹背心、厚重双肩防破片肩甲，胸前挂载机枪弹药箱包与C4炸药模块，背后背着重型军用弹药与破门工具背包；大腿外侧有防弹护板与重型战术护膝。写实现代军事PBR材质，厚重凯夫拉与烤漆钢板质感，次世代3A游戏角色建模。
- **英文 3D 生成提示词（EN Prompt）**：
  > Realistic AAA military game character, heavy breacher and demolitions juggernaut operator, bulky muscular build, full body A-pose, empty hands, unarmed. Wearing heavy ballistic helmet with armored mandible jaw guard and visor, high ballistic neck gorget collar, thick layered heavy plate carrier armor with armored shoulder pauldrons, LMG box magazine pouches and C4 charges on chest, large heavy munitions backpack, thigh armor plates and reinforced knee pads. Dark slate-blue and gunmetal grey tactical palette, photorealistic Call of Duty style PBR textures.

---

### 3. 洞三 · 林峰（玩家主角）—— 精锐尖兵 / 全地形特战突击手
- **目标文件名**：`hero_linfeng.glb`（对应 `marine_player`）
- **体型与气质**：身高 `1.82m`，矫健敏捷的王牌尖兵体型；27 岁冷峻坚毅的年轻特战精英。
- **核心外观特征**：
  - 头部：暗夜碳纤维高切头盔 + **标志性四目全景夜视仪（GPNVG-18，四根夜视镜筒泛青色微光）** + 下半脸黑色战术呼吸半面罩（露出凌厉双眼）。
  - 躯干：暗夜炭黑修身战术软壳冲锋夹克 + 轻量化高机动碳纤维激光切割防弹胸挂 + 左臂战术终端腕表。
  - 背部：低轮廓突击水袋背囊（插有青色荧光棒与快拔工具）。
  - 下肢：修身战术多袋长裤、右侧大腿快拔手枪套、轻量化高帮战术靴。
- **中文 3D 生成提示词（CN Prompt）**：
  > 写实3A军事游戏男主角，27岁王牌特种兵尖兵，矫健修长体型，全身A-pose站立，双手空手无武器。头戴暗夜碳纤维战术头盔，额头挂载标志性四目全景夜视仪（GPNVG-18四筒夜视仪，镜片泛青光），佩戴黑色战术半面罩露出冷峻双眼；身穿炭黑色修身战术软壳夹克与轻量化激光切割防弹背心，背后背着紧凑型战术水袋突击包，右大腿绑有快拔战术枪套。现代暗夜特战写实PBR风格，使命召唤幽灵小队级别细节。
- **英文 3D 生成提示词（EN Prompt）**：
  > Realistic AAA military game protagonist, elite special ops pointman, athletic lean build, full body A-pose, empty hands, unarmed. Wearing matte black carbon high-cut helmet mounted with iconic quad-tube panoramic night vision goggles (GPNVG-18 with subtle cyan lens glow), tactical half-face stealth mask showing sharp eyes, dark charcoal softshell tactical jacket, lightweight laser-cut plate carrier vest, compact hydration assault pack on back, drop-leg holster on right thigh, modern combat boots. Photorealistic Call of Duty Modern Warfare spec-ops style, 4K PBR.

---

### 4. 洞四 · 沈灵（百灵）—— 女性电子战与情报破译专家
- **目标文件名**：`hero_bailing.glb`（对应 `marine_tech`）
- **体型与气质**：身高 `1.70m`，矫健修长的**真实女性特种兵体型**；25 岁干练英气的中国女性电子战专家。
- **核心外观特征**：
  - 头部：清秀坚毅的东亚女性面容，黑色利落高马尾从战术鸭舌帽/轻型战术头盔后方束出 + **右眼佩戴发光青色全息单目 AR 战术目镜** + 骨传导耳麦。
  - 躯干：深蓝黑修身女性战术潜行作战服 + 轻量化贴身防弹胸挂（胸前挂载可翻折军用三防加密平板电脑终端）。
  - 背部：紧凑型卫星电子战折叠终端背包，左右竖立双根细长高频信号侦测天线。
  - 下肢：女性修身战术工装裤、战术腰封、轻便高帮作战靴。
- **中文 3D 生成提示词（CN Prompt）**：
  > 写实3A军事游戏女性角色，25岁中国特种部队女性电子战与情报专家，矫健修长女性体型，全身A-pose站立，双手空手无武器。英气干练的东亚女性面容，利落黑色马尾辫，头戴轻量化战术头盔与骨传导耳麦，右眼佩戴半透明青色发光全息AR战术单目镜；身穿深蓝黑色修身女性战术作战服与轻便防弹胸挂，胸前挂载军用三防加密平板终端，背后背着带双根细天线的紧凑型电子战卫星通讯背包；修身战术裤与作战靴。写实现代军事PBR材质，严禁卡通或过度科幻。
- **英文 3D 生成提示词（EN Prompt）**：
  > Realistic AAA military game female character, 25-year-old East Asian female special forces electronic warfare and recon specialist, athletic slim female build, full body A-pose, empty hands, unarmed. Sharp determined female face, dark ponytail hair, wearing lightweight tactical helmet with comms headset and a glowing cyan holographic AR tactical monocle over her right eye. Wearing fitted dark midnight-navy tactical combat uniform, compact female plate carrier vest with rugged fold-down military tablet on chest, compact satellite EW backpack with dual slim antennas. Photorealistic modern military PBR.

---

## 三、我方基地友军与受保护平民人质（4 套独立角色模型）

### 5. 铁砧营地战术总教官 · 雷震
- **目标文件名**：`char_instructor.glb`（对应 `instructor`）
- **体型与特征**：身高 `1.84m`，45 岁威严硬朗的特战教官；头戴酒红色/深蓝色特种部队贝雷帽与战术墨镜，身穿卷袖教官迷彩作训服、黑色战术背心、挂秒表与哨子、腰部战术枪套。
- **中文 Prompt**：
  > 写实3A军事游戏角色，45岁特种部队魔鬼总教官，全身A-pose站立，空手无武器。头戴特种部队贝雷帽与战术太阳镜，刚毅东亚中年男性面容；身穿卷起袖子的数码迷彩作训服与轻型黑色教官战术背心，胸前挂战术电台与计时器，黑色作战靴。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game character, veteran special forces drill instructor, 45-year-old stern male, full body A-pose, empty hands, unarmed. Wearing military beret and tactical sunglasses, rolled-sleeve camo combat shirt, black tactical instructor vest with radio and stopwatch, cargo pants and combat boots. Photorealistic PBR.

### 6. 战地军医
- **目标文件名**：`char_medic.glb`（对应 `medic`）
- **体型与特征**：身高 `1.78m`，身穿橄榄绿/深灰战地医疗作战服，头戴印有红十字/医疗标识的战术头盔，胸挂与背包带有明显的战地急救医疗包（红白十字标识、止血带、医疗剪刀）。
- **中文 Prompt**：
  > 写实3A军事游戏角色，现代战地军医，全身A-pose站立，空手无武器。头戴带有医疗十字标志的战术头盔，身穿橄榄绿战术作战服与防弹背心，背心与腰部挂载多个带有红十字标志的战地急救医疗包、止血带和医疗背囊。写实军事PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game character, modern combat medic soldier, full body A-pose, empty hands, unarmed. Wearing tactical helmet with red-cross medical emblem, olive drab combat uniform, plate carrier vest loaded with first-aid trauma pouches, tourniquets, and medical backpack with red cross patch. Photorealistic PBR.

### 7. 泰山号远洋货轮老船长 · 陈国海
- **目标文件名**：`char_officer.glb`（对应 `hostage_captain`）
- **体型与特征**：身高 `1.76m`，55 岁沉稳的中国远洋商船老船长；头戴白色远洋船长制式大檐帽，身穿深藏青色双排扣船长制服（肩章带四道金杠），内搭白衬衫与领带，袖口有暴雨夜搏斗留下的少许油污痕迹。
- **中文 Prompt**：
  > 写实3A游戏角色，55岁中国远洋货轮老船长，全身A-pose站立，空手无武器。两鬓微白、神情坚毅的东亚年长男性面容，头戴白色远洋商船船长制式大檐帽，身穿深藏青色带四道金杠肩章的远洋船长制服、白衬衫与深色长裤、黑色皮鞋，衣物带有少许风雨海难磨损痕迹。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA game character, 55-year-old Chinese merchant cargo ship captain, weathered dignified older Asian male, full body A-pose, empty hands, unarmed. Wearing white captain peaked cap with gold badge, dark navy-blue merchant marine captain uniform jacket with gold shoulder stripes over white shirt, dark trousers and leather shoes, subtle storm weathering. Photorealistic PBR.

### 8. 泰山号被劫持中国海员（平民船员人质）
- **目标文件名**：`char_crew.glb`（对应 `hostage_crew`）
- **体型与特征**：身高 `1.75m`，普通远洋货轮海员；头戴黄色或橙色船员安全帽，身穿印有反光条的深蓝色/橙色连体远洋轮机工装服与防滑劳保靴。
- **中文 Prompt**：
  > 写实3A游戏角色，远洋货轮普通船员，全身A-pose站立，空手无武器。头戴黄色安全帽，身穿带有银色反光条的深蓝色远洋船员连体工装服、防油污手套和重型劳保靴，衣服上有少许机油污渍。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA game character, civilian cargo ship crewman and deckhand, full body A-pose, empty hands, unarmed. Wearing yellow hard hat, dark blue maritime utility coveralls with reflective safety stripes, work gloves and steel-toe work boots with subtle grease stains. Photorealistic PBR.

---

## 四、敌方常规兵种：厄普西隆国际雇佣兵 & 哈迪尔叛军（6 套完全不同兵种模型）

> **设计原则**：敌方 6 大兵种严禁共用同一套衣服换色！每个兵种应通过**独特的头饰/面具、护甲厚度和战术剪影**，让玩家在瞄准瞬间就能判断其威胁类型（冲锋/步枪/狙击/盾牌/重甲/特种）。敌方统一采用 **暗红（Crimson）或沙漠褐黑** 敌我识别视觉元素，与我方的青蓝（Cyan）形成鲜明对比。

### 9. 敌方常规步枪兵（Rifleman）
- **目标文件名**：`char_rifleman.glb`（对应 `rifleman`，建议新增独立文件或替换原共用项）
- **战场定位**：中距离主力交火步兵。
- **外观特征**：沙漠卡其与暗褐迷彩作战服 + 黑色骷髅/纯黑巴拉克拉法（Balaclava）蒙面头套 + 轻型防弹胸挂 + 红色敌方战术臂章。
- **中文 Prompt**：
  > 写实3A军事游戏反派雇佣兵步枪手，全身A-pose站立，空手无武器。头戴黑色蒙面头套（Balaclava）与战术耳机，身穿沙漠黄褐与深灰拼接的私人军事承包商（PMC）战术作战服，穿戴黑色防弹背心与弹匣胸挂，右臂绑有暗红色敌方识别臂章，战术护膝与沙漠战靴。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game hostile PMC mercenary rifleman, full body A-pose, empty hands, unarmed. Wearing black balaclava ski mask and tactical headset, arid desert tan and charcoal grey combat shirt and cargo pants, black plate carrier vest with rifle mag pouches, crimson red faction armband on upper arm, desert combat boots. Photorealistic PBR.

---

### 10. 敌方高速近战冲锋手（Rusher）
- **目标文件名**：`char_rusher.glb`（对应 `rusher`）
- **战场定位**：高机动近距离突脸冲锋兵（体型轻便敏捷）。
- **外观特征**：不戴笨重头盔，身穿带风帽的深灰/暗红战术连帽冲锋衣 + 防毒面具（带双侧红色滤毒罐与暗红护目镜片）+ 轻便胸前冲锋枪弹匣挂袋 + 跑酷高机动战术裤。
- **中文 Prompt**：
  > 写实3A军事游戏高机动雇佣兵冲锋手，精瘦敏捷体型，全身A-pose站立，空手无武器。头戴拉起的深灰色战术连帽衫风帽，面部佩戴带暗红色发光镜片的军用防毒面具；身穿轻便暗黑与酒红色拼接的战术冲锋衣，胸前仅穿戴轻量化冲锋枪弹匣绑带，腿部绑有战术匕首鞘与轻便跑酷作战靴。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game hostile mercenary rusher, agile lean build, full body A-pose, empty hands, unarmed. Wearing pulled-up dark tactical hood over a military gas mask with glowing crimson-tinted lenses, lightweight dark charcoal and maroon tactical windbreaker jacket, minimal chest harness with SMG magazine pouches, agile combat pants and lightweight boots. Photorealistic PBR.

---

### 11. 敌方远程狙击手（Sniper）
- **目标文件名**：`char_sniper.glb`（对应 `sniper`）
- **战场定位**：高处哨塔、船桥翼甲板与戈壁悬崖的远程致命狙击手。
- **外观特征**：肩部与头部披挂**不对称荒漠伪装网/吉利服披风（Ghillie Hood & Cape）** + 额头佩戴发红光的激光测距双筒夜视热像仪 + 消音狙击弹袋。
- **中文 Prompt**：
  > 写实3A军事游戏雇佣兵狙击手，全身A-pose站立，空手无武器。头部与双肩披挂带伪装网纹理的荒漠战术吉利服斗篷风帽，面部蒙面并佩戴泛红光的热成像测距护目镜；身穿沙褐色远程侦察作战服、狙击步枪大口径弹匣腰封与攀爬绳索挂具。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game hostile mercenary sniper, full body A-pose, empty hands, unarmed. Wearing tactical desert ghillie hood and ragged camo netting cape draped over shoulders, face mask with glowing red thermal rangefinder goggles, desert recon uniform with large sniper magazine pouches and climbing harness. Photorealistic PBR.

---

### 12. 敌方重装破门霰弹兵 / 盾牌攻坚手（Breacher）
- **目标文件名**：`char_breacher.glb`（对应 `breacher`）
- **战场定位**：室内船舱与地下掩体近战破门重步兵（部分持防爆盾）。
- **外观特征**：焊工级防弹金属面罩头盔（黑色钢面具带十字观察缝）+ 胸前斜挂一排排醒目的红色 12 号霰弹枪子弹带（Shotgun Shell Bandolier）+ 重型防刺防爆背心与护腕。
- **中文 Prompt**：
  > 写实3A军事游戏雇佣兵重装霰弹破门手，壮实体型，全身A-pose站立，空手无武器。头戴黑色防弹钢制焊工面具头盔（带水平观察窄缝），身穿深色重型防爆背心，胸前斜跨醒目的红色霰弹枪子弹带，小臂佩戴重型防爆护臂与防割手套，厚重战术裤与战靴。写实PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game hostile mercenary shotgun breacher, stocky build, full body A-pose, empty hands, unarmed. Wearing black ballistic steel faceplate helmet with narrow eye slit, heavy riot armor vest with bright red 12-gauge shotgun shell bandolier strapped across chest, armored forearm guards, heavy tactical pants and boots. Photorealistic PBR.

---

### 13. 敌方厄普西隆暗夜特种兵（SpecOps）
- **目标文件名**：`char_specops.glb`（对应 `specops`）
- **战场定位**：精锐高AI特种佣兵（会翻滚、投掷闪光弹、精准点射）。
- **外观特征**：全黑碳纤维高科技特种作战服 + **三目红色夜视仪（3-Lens Red NVG，致敬细胞分裂式的猩红三眼夜视镜）** + 黑色全覆式战术头盔 + 紧凑型电子干扰背囊。
- **中文 Prompt**：
  > 写实3A军事游戏反派精锐暗夜特种兵，全身A-pose站立，空手无武器。头戴全黑哑光特种作战头盔与面罩，额头佩戴标志性的猩红色三目夜视仪（三个呈三角形排列的红色发光镜头）；身穿全黑蜂窝碳纤维纹理的高科技特战紧身防弹作战服、黑色模块化胸挂与小型战术背包。写实次世代3A游戏PBR材质。
- **英文 Prompt**：
  > Realistic AAA military game elite hostile black-ops commando, full body A-pose, empty hands, unarmed. Wearing matte black full-cover tactical helmet and mask with iconic three-lens glowing crimson red night-vision goggles, sleek black carbon-weave spec-ops combat suit, black modular plate carrier and compact tactical pack. Photorealistic PBR.

---

### 14. 敌方重装防爆机枪兵（Heavy Juggernaut）
- **目标文件名**：`char_heavy.glb`（对应常规 `heavy`）
- **战场定位**：高血量压制型重机枪无畏装甲兵。
- **外观特征**：全套橄榄褐/炭黑重型 EOD 排爆无畏装甲（Juggernaut Suit）+ 巨大防弹高领护颈 + 厚重金属防弹观察窗头盔 + 腰部环绕黄铜机枪弹链。
- **中文 Prompt**：
  > 写实3A军事游戏重装无畏机枪兵（Juggernaut），高大魁梧，全身A-pose站立，空手无武器。全身穿戴极度厚重的炭黑色与军绿色重型EOD排爆防弹装甲服，头戴带有厚防弹玻璃窄窗的重型防爆头盔与巨型防弹护颈，胸前与腰部缠绕黄铜重机枪金属弹链，全身覆盖厚实凯夫拉防爆护垫与钢板。使命召唤重装无畏战士写实PBR风格。
- **英文 Prompt**：
  > Realistic AAA military game heavy juggernaut gunner, massive bulky build, full body A-pose, empty hands, unarmed. Wearing full heavy EOD bomb-disposal juggernaut armor suit in dark charcoal and olive drab, heavy bomb helmet with thick narrow ballistic glass visor and massive neck collar, brass machine-gun ammo belts wrapped across chest, heavy padded kevlar limb armor. Call of Duty Juggernaut photorealistic PBR.

---

## 五、三大终局 / 压轴 BOSS（3 套旗舰级 BOSS 角色模型 + 3 把独立 BOSS 重武器）

> **设计原则**：三大 BOSS 必须具备**极具压迫感且截然不同的轮廓与视觉母题**（深海战舰重型动力机甲 vs 戈壁隐身外骨骼猎杀者 vs 赤沙黑金重甲狂暴军阀）。
> 建议将 **BOSS 本体（空手 A-Pose）** 与 **BOSS 专属重武器** 分别生成，引擎会自动将重武器挂载到 BOSS 手部骨骼！

### 15. 第一关终局 BOSS：「铁锚」克洛诺斯（泰山号船艏重甲处刑者）
- **目标文件名**：
  - 角色本体：`boss_kronos.glb`（对应 `boss_kronos`）
  - 专属武器：`wpn_boss_gatling.glb`（或替换 `boss_kronos_kit.glb` 中的 `BossGun`）
- **身高与定位**：`2.15m` 巨型重装战舰动力外骨骼处刑者，镇守暴雨夜泰山号万吨货轮船艏停机坪。
- **核心外观特征**：
  - 船厂工业重甲美学：由厚重的**深灰氧化舰艇装甲钢板、黄铜铆钉、外露液压助力机械臂、背部双根冒红光的柴油涡轮排气管**拼装而成的重型动力装甲。
  - 头部与胸口：潜水钟式重型装甲头盔（横向猩红色独眼扫描光带），胸口正中镶嵌一座**发光猩红熔炉反应核心（带金属防护格栅）**，肩部焊有巨大的船锚浮雕防爆钢盾。
- **BOSS 本体中文 Prompt**：
  > 写实3A军事科幻游戏巨型重装BOSS角色，代号“铁锚”，全身A-pose站立，双手空手无武器。身高2.2米的巨型工业外骨骼重甲战士，全身覆盖由远洋战舰暗灰色厚重焊接钢板、黄铜铆钉与液压机械外骨骼构成的动力装甲；头戴全封闭重装甲头盔，面罩为一道散发刺眼红光的横向独眼扫描槽；胸口正中镶嵌圆形发光猩红核反应炉核心，双肩焊接厚重防爆钢盾并刻有铁锚标志，背后背着带双根金属排气管的动力涡轮背包。写实工业重金属与战损锈迹PBR材质，3A大作BOSS级建模。
- **BOSS 本体英文 Prompt**：
  > Realistic AAA game heavy boss character, codename Iron Anchor Kronos, full body A-pose, empty hands, unarmed. Colossal 2.2m industrial naval dreadnought exoskeleton juggernaut, clad in thick welded battleship gunmetal steel plates, brass rivets, and hydraulic power-armor limbs. Heavy armored diving-bell helmet with a glowing crimson horizontal cyclops visor slit, a blazing red circular reactor core embedded in the center of the chest plate, massive riveted shoulder shields with anchor relief, twin diesel exhaust stacks on back. Gritty weathered naval steel 4K PBR.
- **专属重武器 Prompt（四管旋转重型加特林机炮）**：
  > 写实3A军事重型武器3D模型，四管旋转重型加特林机炮，暗黑枪身与四根带黄铜固定箍的旋转重型枪管，侧面挂载重型金属弹鼓与红色过热指示灯，无人物手部，横向水平放置，写实枪械金属PBR材质。

---

### 16. 第二关终局 BOSS：指挥官 · 毒蛇（厄普西隆战区总指挥）
- **目标文件名**：
  - 角色本体：`boss_viper.glb`（对应 `boss_viper`）
  - 专属武器：`wpn_boss_railgun.glb`
- **身高与定位**：`1.95m` 高机动流线型外骨骼战术统帅，镇守中亚戈壁喀拉干达 7 号油田悬崖卫星站（会高频战术翻滚规避、发射双肩微型导弹）。
- **核心外观特征**：
  - 高科技流线型隐身美学：**沙漠金褐与暗夜碳纤维**流线型贴身动力外骨骼（类似《合金装备》或《泰坦陨落》精英铁驭）。
  - 头部与双肩：猎食者式斜切碳纤维全覆头盔（带有毒蛇獠牙状的双目猩红发光光学面罩），**双肩高耸挂载一对可开合的六联装微型高爆导弹发射巢（露出红色导弹头）**，背部有折角空气动力稳定翼。
- **BOSS 本体中文 Prompt**：
  > 写实3A军事科幻游戏敏捷型外骨骼BOSS角色，代号“指挥官毒蛇”，全身A-pose站立，双手空手无武器。矫健修长的高科技外骨骼体型，身穿沙漠金褐与黑色碳纤维拼接的流线型隐身动力外骨骼装甲；头戴流线型猎杀者全覆式战术头盔，面甲上亮起一对毒蛇般斜切的猩红色发光光学电子眼；双肩上方各搭载一座矩形六联装微型导弹发射巢（可见内部6枚红色微型导弹弹头），背部带有碳纤维战术稳定翼与机械脊椎。写实次世代3A游戏PBR材质。
- **BOSS 本体英文 Prompt**：
  > Realistic AAA sci-fi military boss character, Commander Viper, agile sleek build, full body A-pose, empty hands, unarmed. Wearing aerodynamic desert-tan and black carbon-fiber stealth exoskeleton suit, angular predator full-face helmet with twin slanted glowing crimson optical visor eyes, dual shoulder-mounted 6-tube micro-missile launcher pods resting above both shoulders showing red warhead tips, articulated mechanical spine and carbon stabilizer fins on back. Metal Gear / Titanfall pilot inspired photorealistic 4K PBR.
- **专属重武器 Prompt（双轨电磁脉冲高能连狙）**：
  > 写实3A军事科幻武器3D模型，双轨电磁脉冲狙击步枪，修长黑色碳纤维与沙漠黄枪身，上下平行双根电磁加速导轨，导轨中间散发青蓝色电弧微光，顶部配有高精度战术瞄准镜，无人物手部，写实PBR材质。

---

### 17. 哈迪尔防线 BOSS：「赤沙暴君」（哈迪尔武装最高统帅）
- **目标文件名**：
  - 角色本体：`boss_tyrant.glb`（对应 `boss_tyrant`）
  - 专属武器：`wpn_boss_autocannon.glb`
- **身高与定位**：`2.10m` 压迫感极强的黑金猩红重甲军阀统帅，在哈迪尔防线每第 3/6/9… 波率军压阵。
- **核心外观特征**：
  - 废土军阀与现代重甲融合美学：**曜石黑、暗血红与鎏金**三色重型复合装甲。
  - 头部与躯干：带有**鎏金双角/弯月战冠的重型防爆战神头盔 + 燃烧熔岩橙光的威慑面甲**，双肩为层叠黑金红重型带刺肩甲，胸前为雕有金色猛兽/烈阳纹章的重型防弹胸甲（缝隙透出炽热熔炉橙光），腰部垂有防弹叠片战术甲裙，背部背负双联高压燃料气瓶。
- **BOSS 本体中文 Prompt**：
  > 写实3A军事动作游戏重甲统帅BOSS角色，代号“赤沙暴君”，高大威猛体型，全身A-pose站立，双手空手无武器。身穿曜石黑、暗血红与纯金镶边的重型军阀复合动力装甲；头戴镶嵌金色双角战冠的重型防爆战神头盔，面罩缝隙透出炽热的熔岩橙红光芒；双肩穿戴层叠的黑金红重型装甲护肩，胸甲厚重并带有金色浮雕纹饰与发光散热格栅，腰部配有防弹战术叠片甲裙，背后背负两枚黑金配色的高压燃料气瓶。写实金属烤漆与战损鎏金PBR材质，3A游戏霸主级建模。
- **BOSS 本体英文 Prompt**：
  > Realistic AAA military action game warlord boss character, Red Sand Tyrant, imposing muscular build, full body A-pose, empty hands, unarmed. Clad in heavy obsidian-black, dark crimson, and burnished gold warlord composite power armor; wearing a menacing horned tactical warlord helmet with glowing molten-amber visor slits, layered black-crimson-gold armored shoulder pauldrons, heavy chest cuirass with glowing furnace vents and gold trim, tactical armored tassets around waist, and twin pressurized fuel cylinders mounted on back. Photorealistic 4K metallic PBR.
- **专属重武器 Prompt（黑金重型爆破突击火炮）**：
  > 写实3A军事重武器3D模型，黑金配色重型单兵爆破突击火炮，粗大曜石黑炮管配鎏金枪口制退器，暗红色散热护木侧面带有发光熔岩橙色散热槽，厚重盒式供弹机匣，无人物手部，写实重金属PBR材质。

---

## 六、模型生成后的一键替换说明

当您使用其他 3D 生成模型产出上述 `.glb`（或 `.fbx` / `.obj`）文件后：
1. 直接将生成的模型文件放入工程目录（如 `e:\greatfps\public\assets\models\` 或任意临时文件夹），告诉我一声；
2. 我会用本地内置的 **Blender 4.2 自动化管线** 为您自动完成：
   - **尺寸与朝向归零校准**（自动对齐 `Y = 0` 脚底平面与身高比例）；
   - **自动 24 骨骼权重绑定与手部持枪点校准**（即便生成的是无骨骼静态白模，也能在数秒内自动传递标准 24 骨骼权重并接入游戏全套动作系统）；
   - **PBR 材质与贴图压缩优化**并实时截图供您验收。
