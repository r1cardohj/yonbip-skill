export interface DictIndexMeta {
  version: string;
  generatedAt: string;
  totals: { treeNodes: number; tables: number; fields: number };
  modules: { name: string; code: string; count: number }[];
}

export interface RawTable {
  id: string;
  treeName: string;
  displayName: string;
  tableName: string;
  fullClassname: string;
  module: string;
  moduleCode: string;
  path: string;
  fieldCount: number;
  requiredCount: number;
  keyFields: string[];
  tableSearchText: string;
  fieldSearchText: string;
}

// tables.jsonl 中保留的精简结构（去掉两个 searchText 后 index.json 可从缓存清理）
export interface TableMeta {
  id: string;
  tableName: string;
  displayName: string;
  fullClassname: string;
  module: string;
  moduleCode: string;
  fieldCount: number;
  requiredCount: number;
  keyFields: string[];
}

export interface RawField {
  name: string;
  displayName: string;
  dataTypeSql?: string;
  keyProp?: boolean;
  nullable?: boolean;
  dataScope?: string;
  help?: string;
  refClassPathHref?: string;
}

export interface TableDetail {
  propertyVO: RawField[];
}

// fields.jsonl 记录，键名压缩以控制 50 万级记录的体积
// t=tableId tbl=tableName n=name dn=displayName ty=dataTypeSql ref=refId k=keyProp nl=nullable
export interface FieldRec {
  t: string;
  tbl: string;
  n: string;
  dn: string;
  ty: string;
  ref: string;
  k: boolean;
  nl: boolean;
}

export interface ParsedRef {
  refId: string;
  refName: string;
  refCode: string;
}
