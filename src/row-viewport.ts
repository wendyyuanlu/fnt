export class RowViewport {
  offsets:number[]=[];
  constructor(readonly heights:number[]){this.rebuild();}
  rebuild():void {
    this.offsets=[0];
    for(const height of this.heights)this.offsets.push(this.offsets.at(-1)!+height);
  }
  at(top:number):number {
    let low=0,high=this.heights.length;
    while(low<high){const mid=(low+high)>>>1;if(this.offsets[mid+1]<=top)low=mid+1;else high=mid;}
    return Math.max(0,Math.min(this.heights.length-1,low));
  }
  window(top:number,height:number):{start:number;end:number;before:number;after:number} {
    const start=Math.max(0,this.at(top)-10),end=Math.min(this.heights.length,this.at(top+height)+11);
    return {start,end,before:this.offsets[start],after:this.offsets.at(-1)!-this.offsets[end]};
  }
}
