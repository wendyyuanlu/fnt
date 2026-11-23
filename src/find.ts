type Token={kind:'literal';value:string}|{kind:'any'|'star'};
type MatchRange={start:number;end:number};
export interface TextSearchOptions {matchCase:boolean;entire:boolean}

export function createTextSearch(query:string,options:TextSearchOptions){
  const tokens:Token[]=[],characters=Array.from(query);
  for(let i=0;i<characters.length;i++){
    const value=characters[i];
    if(value==='~'&&['*','?','~'].includes(characters[i+1]))tokens.push({kind:'literal',value:characters[++i]});
    else if(value==='*'){if(tokens.at(-1)?.kind!=='star')tokens.push({kind:'star'});}
    else tokens.push(value==='?'?{kind:'any'}:{kind:'literal',value});
  }
  if(!tokens.length)return {matches:()=>false,ranges:():MatchRange[]=>[],replace:(text:string)=>text};
  const fold=(value:string)=>options.matchCase?value:value.toLowerCase();
  if(!tokens.some(token=>token.kind==='star')){
    const pattern=tokens.map(token=>token.kind==='literal'?token.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'.').join('');
    const regex=new RegExp(options.entire?`^(?:${pattern})$`:pattern,options.matchCase?'su':'isu');
    const matches=(text:string)=>{const match=regex.exec(text);return!!match&&(!options.entire||match[0].length===text.length);};
    return {
      matches,
      ranges:(text:string):MatchRange[]=>matches(text)?Array.from(text.matchAll(new RegExp(regex.source,regex.flags+'g')),match=>({start:match.index,end:match.index+match[0].length})):[],
      replace:(text:string,value:string)=>matches(text)?text.replace(new RegExp(regex.source,regex.flags+'g'),()=>value):text
    };
  }
  const literals=tokens.map(token=>token.kind==='literal'?fold(token.value):'');
  // Track earliest starts per prefix instead of backtracking through wildcard spans.
  const span=(text:string):{start:number;end:number}|undefined=>{
    const values=Array.from(text),offsets=[0];
    for(const value of values)offsets.push(offsets.at(-1)!+value.length);
    let states=new Int32Array(tokens.length+1).fill(-1),best:{start:number;end:number}|undefined;
    states[0]=0;
    const put=(target:Int32Array,index:number,start:number)=>{if(start>=0&&(target[index]<0||start<target[index]))target[index]=start;};
    for(let position=0;position<=values.length;position++){
      if(!options.entire)put(states,0,position);
      for(let i=0;i<tokens.length;i++)if(tokens[i].kind==='star')put(states,i+1,states[i]);
      const start=states[tokens.length];
      if(start>=0&&(!options.entire||position===values.length)&&(!best||start<best.start||start===best.start&&position>best.end))best={start,end:position};
      if(position===values.length)break;
      const next=new Int32Array(tokens.length+1).fill(-1),value=fold(values[position]);
      for(let i=0;i<tokens.length;i++){
        if(tokens[i].kind==='star')put(next,i,states[i]);
        else if(tokens[i].kind==='any'||literals[i]===value)put(next,i+1,states[i]);
      }
      states=next;
    }
    return best?{start:offsets[best.start],end:offsets[best.end]}:undefined;
  };
  return {
    matches:(text:string)=>!!span(text),
    ranges:(text:string):MatchRange[]=>{const match=span(text);return match?[match]:[];},
    replace:(text:string,value:string)=>{const match=span(text);return match?text.slice(0,match.start)+value+text.slice(match.end):text;}
  };
}
