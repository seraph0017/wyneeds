export const baggageRules = [
  { cabin: '头等舱', checked: '40kg', carryOn: '2件，每件≤5kg' },
  { cabin: '公务舱', checked: '30kg', carryOn: '1件，每件≤5kg' },
  { cabin: '经济舱', checked: '20kg', carryOn: '1件，每件≤5kg' },
];

export const refundRules = [
  { cabin: '头等舱', before: '收取票价5%', after: '收取票价10%' },
  { cabin: '公务舱', before: '收取票价5%', after: '收取票价10%' },
  { cabin: '经济舱全价', before: '收取票价5%', after: '收取票价20%' },
  { cabin: '经济舱折扣票', before: '按各航司具体规则', after: '按各航司具体规则' },
];

export const baggageNotes = [
  '儿童票：免费托运行李额与成人标准相同。',
  '婴儿票：不享受免费托运行李额，可按航司规定申请婴儿车托运。',
  '超额行李费用模拟公式：超重公斤数 × 经济舱全价票价 × 1.5%。',
];

export const refundNotes = [
  '退票金额计算公式：应退金额 = 已付票价 - 退票手续费。',
  '退票时限按航班起飞前/起飞后区分，本系统用于课堂模拟。',
  '革命伤残军人、因病退票等特殊情况按航司和有效证明处理，本系统仅展示规则说明。',
];

export const changeRules = [
  '同舱位改期按票价3%模拟收取手续费。',
  '升舱改签补收新旧舱位差价，并按票价5%模拟收取手续费。',
  '降舱改签按航司政策退还差价，本系统用于教学时仅展示计算过程。',
  '签转规则仅做说明展示，不连接真实航司系统。',
];

export const specialPassengerRules = [
  '无成人陪伴儿童（UM）：年龄5-12周岁，需要填写送机人和接机人信息，服务费按航司标准收取，本系统按课堂模拟展示。',
  '无人陪伴青少年：12-18周岁可申请，本系统作为规则说明展示。',
  '婴儿旅客：14天-2周岁，不单独占座，需成人陪同；婴儿摇篮可按航司规则提前申请。',
  '孕妇旅客：32周以下普通运输，32周以上需医疗证明。',
  '残障旅客：辅助设备免费运输说明。',
  '重要旅客（VIP）：优先服务说明。',
];

export const ruleReference = '参照中国民用航空局（CAAC）现行民用航空旅客运输管理规定及相关规范性文件，用于教学模拟。';

export const rules = {
  baggageRules,
  baggageNotes,
  refundRules,
  refundNotes,
  changeRules,
  specialPassengerRules,
  ruleReference,
};
