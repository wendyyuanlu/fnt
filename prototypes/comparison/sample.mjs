export function comparisonSample(){
  const sheet=(id,name)=>({
    id,name,color:'#307867',rows:Array.from({length:36},(_,i)=>({id:`${id}-r${i}`})),
    columns:Array.from({length:8},(_,i)=>({id:`${id}-c${i}`,label:String.fromCharCode(65+i)})),
    cells:{},groups:[],validations:[],
  });
  const master=sheet('sample-master','Master'),meals=sheet('sample-meals','Meals');
  const table=(s,id,names)=>({
    id,name:s.name,sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,30).map(r=>r.id),
    columns:names.map((name,i)=>({id:`${id}-f${i}`,column:s.columns[i].id,name})),
  });
  const tables=[table(master,'sample-days',['Date','Weight','Food','Amount','Calories']),table(meals,'sample-meals-table',['Meal','Ingredient','Amount','Calories'])];
  const cell=(s,r,c,value)=>s.cells[`${s.rows[r].id}:${s.columns[c].id}`]={value};
  for(const s of [master,meals]){
    const t=tables.find(t=>t.sheet===s.id);
    t.columns.forEach((f,i)=>cell(s,0,i,f.name));
  }
  cell(master,3,0,'11/20');cell(master,3,1,60);cell(master,4,2,'Invented oats');cell(master,4,3,40);
  cell(master,20,2,'Invented apple');cell(master,20,3,120);cell(master,33,7,'Invented note');
  cell(meals,5,0,'Invented lunch');cell(meals,6,1,'Invented beans');cell(meals,6,2,100);
  const left={schema:1,id:'comparison-demo',title:'Invented comparison',revision:1,sheets:[master,meals],tables,names:[],pickerSources:{},toolbarOrder:['action:file','action:save']};
  const right=structuredClone(left);
  cell(right.sheets[0],3,1,61);cell(right.sheets[0],4,3,45);cell(right.sheets[0],20,3,140);cell(right.sheets[0],33,7,'Another invented note');
  right.sheets[0].rows[20].hypotheticalTables={'sample-days':true};
  right.sheets[0].groups.push({id:'sample-group',axis:'row',kind:'summary',members:master.rows.slice(3,6).map(r=>r.id),table:'sample-days',label:'Invented day',collapsed:false});
  cell(right.sheets[1],6,2,150);right.toolbarOrder.reverse();
  return{left,right,meta:{left:'Invented phone copy',right:'Invented desktop copy',leftDevice:'Demo phone'}};
}
