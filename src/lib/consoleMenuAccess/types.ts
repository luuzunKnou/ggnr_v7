/** 관리 콘솔 영역 (추후 공지·자료실 등 확장) */
export type ConsoleAreaId = 'dev' | 'sysManager' | 'notice' | 'library';

export type ConsoleMenuDef = {
  id: string;
  label: string;
};

export type ConsoleAreaDef = {
  label: string;
  menus: readonly ConsoleMenuDef[];
};

/** 0=없음(hidden) 1=버튼보기(block+알림) 2=읽기 3=쓰기 */
export type ConsoleMenuPolicy = 'hidden' | 'block' | 'read' | 'write';

export type ConsoleMenuLevelSnapshot = Record<string, number>;

export type ConsoleMenuAccessContextValue = {
  area: ConsoleAreaId | null;
  menuId: string | null;
  policy: ConsoleMenuPolicy;
  canRead: boolean;
  canWrite: boolean;
  loading: boolean;
};
