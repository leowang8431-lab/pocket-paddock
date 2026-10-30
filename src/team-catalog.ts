/** Roster and numbers follow the user-supplied indices, not a claimed season entry list. */
export type TeamId = 'mclaren' | 'ferrari' | 'redbull' | 'mercedes' | 'aston' | 'alpine' | 'williams' | 'haas' | 'racingbulls' | 'audi' | 'cadillac';
export type DriverId = 'lando_norris_04' | 'oscar_piastri_81' | 'charles_leclerc_16' | 'lewis_hamilton_44' | 'max_verstappen_01' | 'isack_hadjar_06' | 'george_russell_63' | 'kimi_antonelli_12' | 'fernando_alonso_14' | 'lance_stroll_18' | 'pierre_gasly_10' | 'franco_colapinto_43' | 'alex_albon_23' | 'carlos_sainz_55' | 'esteban_ocon_31' | 'oliver_bearman_87' | 'liam_lawson_30' | 'arvid_lindblad_41' | 'nico_hulkenberg_27' | 'gabriel_bortoleto_05' | 'sergio_perez_11' | 'valtteri_bottas_77';

export interface DriverOption {
  id: DriverId;
  name: string;
  label: string;
  number: number;
  teamId: TeamId;
}

export interface TeamOption {
  id: TeamId;
  name: string;
  label: string;
  color: string;
  drivers: DriverOption[];
}

function driver(teamId: TeamId, id: DriverId, name: string, label: string, number: number): DriverOption {
  return {teamId, id, name, label, number};
}

export const teams: TeamOption[] = [
  {id:'mclaren', name:'McLaren', label:'迈凯伦', color:'#e77f20', drivers:[
    driver('mclaren','lando_norris_04','Lando Norris','诺里斯',4),
    driver('mclaren','oscar_piastri_81','Oscar Piastri','皮亚斯特里',81),
  ]},
  {id:'ferrari', name:'Ferrari', label:'法拉利', color:'#d8473d', drivers:[
    driver('ferrari','charles_leclerc_16','Charles Leclerc','勒克莱尔',16),
    driver('ferrari','lewis_hamilton_44','Lewis Hamilton','汉密尔顿',44),
  ]},
  {id:'redbull', name:'Red Bull Ford', label:'红牛福特', color:'#33497b', drivers:[
    driver('redbull','max_verstappen_01','Max Verstappen','维斯塔潘',1),
    driver('redbull','isack_hadjar_06','Isack Hadjar','哈贾尔',6),
  ]},
  {id:'mercedes', name:'Mercedes', label:'梅赛德斯', color:'#279b90', drivers:[
    driver('mercedes','george_russell_63','George Russell','拉塞尔',63),
    driver('mercedes','kimi_antonelli_12','Kimi Antonelli','安东内利',12),
  ]},
  {id:'aston', name:'Aston Martin', label:'阿斯顿·马丁', color:'#267764', drivers:[
    driver('aston','fernando_alonso_14','Fernando Alonso','阿隆索',14),
    driver('aston','lance_stroll_18','Lance Stroll','斯特罗尔',18),
  ]},
  {id:'alpine', name:'Alpine', label:'阿尔派', color:'#3c8cbf', drivers:[
    driver('alpine','pierre_gasly_10','Pierre Gasly','加斯利',10),
    driver('alpine','franco_colapinto_43','Franco Colapinto','科拉平托',43),
  ]},
  {id:'williams', name:'Williams', label:'威廉姆斯', color:'#3369bf', drivers:[
    driver('williams','alex_albon_23','Alex Albon','阿尔本',23),
    driver('williams','carlos_sainz_55','Carlos Sainz','塞恩斯',55),
  ]},
  {id:'haas', name:'Haas', label:'哈斯', color:'#858a8a', drivers:[
    driver('haas','esteban_ocon_31','Esteban Ocon','奥康',31),
    driver('haas','oliver_bearman_87','Oliver Bearman','比尔曼',87),
  ]},
  {id:'racingbulls', name:'Racing Bulls', label:'红牛二队', color:'#5368b8', drivers:[
    driver('racingbulls','liam_lawson_30','Liam Lawson','劳森',30),
    driver('racingbulls','arvid_lindblad_41','Arvid Lindblad','林德布拉德',41),
  ]},
  {id:'audi', name:'Audi', label:'奥迪', color:'#c3463d', drivers:[
    driver('audi','nico_hulkenberg_27','Nico Hulkenberg','霍肯伯格',27),
    driver('audi','gabriel_bortoleto_05','Gabriel Bortoleto','博托莱托',5),
  ]},
  {id:'cadillac', name:'Cadillac', label:'凯迪拉克', color:'#717973', drivers:[
    driver('cadillac','sergio_perez_11','Sergio Perez','佩雷兹',11),
    driver('cadillac','valtteri_bottas_77','Valtteri Bottas','博塔斯',77),
  ]},
];

export const DEFAULT_TEAM: TeamId = 'ferrari';
export const DEFAULT_DRIVER: DriverId = 'charles_leclerc_16';
const teamMap = new Map(teams.map(team=>[team.id,team]));
const driverMap = new Map(teams.flatMap(team=>team.drivers).map(entry=>[entry.id,entry]));

export function isTeamId(value: unknown): value is TeamId {
  return typeof value === 'string' && teamMap.has(value as TeamId);
}
export function isDriverId(value: unknown): value is DriverId {
  return typeof value === 'string' && driverMap.has(value as DriverId);
}
export function getTeam(id: TeamId): TeamOption { return teamMap.get(id)!; }
export function getDriver(id: DriverId): DriverOption { return driverMap.get(id)!; }
