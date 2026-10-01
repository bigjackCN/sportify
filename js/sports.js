// 项目英文名 → 中文名（官网只有英文/日文）。找不到时显示英文原名。
const ZH = {
  'Swimming': '游泳', 'Marathon Swimming': '马拉松游泳', 'Diving': '跳水', 'Artistic Swimming': '花样游泳', 'Water Polo': '水球',
  'Archery': '射箭', 'Athletics': '田径', 'Badminton': '羽毛球', 'Baseball': '棒球', 'Softball': '垒球',
  'Basketball': '篮球', '3x3 Basketball': '三人篮球', 'Boxing': '拳击', 'Breaking': '霹雳舞',
  'Canoe Sprint': '皮划艇静水', 'Canoe Slalom': '皮划艇激流回旋', 'Cricket': '板球',
  'Cycling Road': '公路自行车', 'Cycling Track': '场地自行车', 'Cycling Mountain Bike': '山地自行车',
  'Cycling BMX Racing': '小轮车竞速', 'Cycling BMX Freestyle': '小轮车自由式',
  'Equestrian': '马术', 'Equestrian Dressage': '马术盛装舞步', 'Equestrian Jumping': '马术场地障碍', 'Equestrian Eventing': '马术三项赛',
  'Esports': '电子竞技', 'Fencing': '击剑', 'Football': '足球', 'Golf': '高尔夫球',
  'Artistic Gymnastics': '竞技体操', 'Rhythmic Gymnastics': '艺术体操', 'Trampoline': '蹦床', 'Trampoline Gymnastics': '蹦床',
  'Handball': '手球', 'Hockey': '曲棍球', 'Judo': '柔道', 'Ju-Jitsu': '柔术', 'Jujitsu': '柔术', 'Karate': '空手道', 'Kurash': '克柔术',
  'Modern Pentathlon': '现代五项', 'Rowing': '赛艇', 'Rugby Sevens': '七人制橄榄球', 'Rugby': '橄榄球', 'Sailing': '帆船帆板',
  'Shooting': '射击', 'Skateboarding': '滑板', 'Sport Climbing': '攀岩', 'Squash': '壁球', 'Surfing': '冲浪',
  'Table Tennis': '乒乓球', 'Taekwondo': '跆拳道', 'Tennis': '网球', 'Soft Tennis': '软式网球', 'Triathlon': '铁人三项',
  'Volleyball': '排球', 'Beach Volleyball': '沙滩排球', 'Weightlifting': '举重', 'Wrestling': '摔跤', 'Wushu': '武术',
  'Mixed Martial Arts': '综合格斗', 'Padel': '板式网球', 'Sepaktakraw': '藤球', 'Sepak Takraw': '藤球', 'Kabaddi': '卡巴迪',
  'Canoe Dragon Boat': '龙舟', 'Dragon Boat': '龙舟', 'Bridge': '桥牌', 'Go': '围棋', 'Xiangqi': '象棋', 'Chess': '国际象棋',
  'Roller Sports': '轮滑', 'Bowling': '保龄球', 'Dancesport': '体育舞蹈', 'Kendo': '剑道', 'Soft Tennis ': '软式网球'
}

export function sportName(en, lang) {
  if (!en) return ''
  if (lang !== 'zh') return en
  return ZH[en] || ZH[en.replace(/ - .*$/, '')] || en
}
