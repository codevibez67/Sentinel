export class Session {
  review(payload) { this.payload=structuredClone(payload); this.approved=false; }
  approve() { if(!this.payload) throw Error('Scan the page first.'); this.approved=true; }
  invalidate() { this.approved=false; this.payload=null; }
  take() {
    if(!this.approved || !this.payload) throw Error('Approve the current preview before Run.');
    const payload=structuredClone(this.payload); this.invalidate(); return payload;
  }
}
