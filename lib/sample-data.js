/* Fictional horses and figures for demo purposes only. Generated, not real data. */
(function (root) {
  const SAMPLE_CSV = `
horse,date,track,race,distance,surface,call1,call1Lengths,field,beyer,ragozin,thorograph,brisnet,timeform,equibase,thoromanager
Copper Comet,2026-04-05,GP,6,6f,D,1,0,6,108,3",,,131,110,
Copper Comet,2026-05-01,SA,5,1m,D,2,1,7,103,6,5,111,124,106,100
Copper Comet,2026-05-27,GP,2,6 1/2f,D,1,0,6,106,4",3+,109,126,110,104
Copper Comet,2026-06-22,BEL,6,1 1/16m,D,1,0.5,10,104,7-,6-,109,123,108,101
Copper Comet,2026-07-18,GP,5,1m70y,D,3,2,9,101,7+,7",106,121,103,
Copper Comet,2026-08-13,KEE,9,1m,D,1,0,6,98,7,8,104,117,103,95
Midnight Ledger,2026-04-08,KEE,7,7f,D,3,3,10,102,6+,5",107,120,102,99
Midnight Ledger,2026-05-04,BEL,9,1 1/8m,T,3,3,10,98,9,10-,102,114,101,96
Midnight Ledger,2026-05-30,SA,4,7f,D,4,4,8,99,7+,6",105,116,102,
Midnight Ledger,2026-06-25,SA,1,7f,D,3,2,8,96,8",,101,113,100,92
Midnight Ledger,2026-07-21,GP,1,1m70y,T,3,3,8,100,6",,109,123,103,
Midnight Ledger,2026-08-16,SA,7,1m70y,D,4,4.5,8,94,9",9,,114,98,95
Rolling Thunderbay,2026-04-11,KEE,1,7f,D,5,5.5,9,,10+,9",96,110,95,89
Rolling Thunderbay,2026-05-07,KEE,4,6f,D,6,7,6,94,,8-,100,108,98,
Rolling Thunderbay,2026-06-02,SA,2,6f,D,5,5.5,9,91,9-,7",97,108,93,89
Rolling Thunderbay,2026-06-28,SA,5,6 1/2f,D,5,5.5,9,95,8+,8,99,,99,93
Rolling Thunderbay,2026-07-24,KEE,6,1 1/16m,D,6,7,11,95,10+,10-,,115,100,95
Rolling Thunderbay,2026-08-19,GP,8,1m,D,4,4,6,98,8,,103,119,102,
Saratoga Whisper,2026-04-14,AQU,1,7f,D,2,1,9,101,7+,5+,104,119,,99
Saratoga Whisper,2026-05-10,SAR,7,1m70y,D,4,3.5,10,103,6+,6-,108,126,104,99
Saratoga Whisper,2026-06-05,BEL,10,6f,D,2,1.5,10,102,5,5+,107,,105,100
Saratoga Whisper,2026-07-01,GP,2,1 1/8m,D,1,0.5,11,97,11,9+,102,116,99,94
Saratoga Whisper,2026-07-27,AQU,1,1 1/8m,D,4,4,9,104,6+,,108,,106,101
Saratoga Whisper,2026-08-22,SAR,4,1 1/8m,D,2,1,6,103,7",7",107,119,105,
Iron Quill,2026-04-17,KEE,3,1 1/8m,D,6,9.5,6,95,,10+,100,,100,94
Iron Quill,2026-05-13,SAR,9,1 1/8m,D,8,10.5,8,92,12",10,97,108,99,
Iron Quill,2026-06-08,SAR,7,1m,D,7,7.5,9,95,11,11,98,,97,91
Iron Quill,2026-07-04,SA,10,6f,T,7,9,7,92,7",7",97,,96,92
Iron Quill,2026-07-30,GP,2,1 1/16m,D,7,10,7,90,12",11+,96,107,94,89
Iron Quill,2026-08-25,SAR,8,1 1/8m,D,6,9,6,94,,10,,113,99,
Lady Tempo,2026-04-20,CD,5,1 1/8m,D,3,2.5,9,90,13,13-,96,110,93,91
Lady Tempo,2026-05-16,GP,4,6f,D,1,0,7,96,7",,99,,98,91
Lady Tempo,2026-06-11,AQU,2,1 1/16m,D,1,0.5,11,,10-,9,104,116,102,
Lady Tempo,2026-07-07,CD,9,1m,T,3,2,7,98,9,8,103,116,100,94
Lady Tempo,2026-08-02,CD,3,1m,D,2,1,6,97,10,9,101,116,101,
Lady Tempo,2026-08-28,BEL,5,6 1/2f,T,4,4,10,99,7",6,,119,102,96
Harbor Sentinel,2026-04-23,CD,8,1 1/8m,T,4,3.5,10,88,,14+,93,103,92,89
Harbor Sentinel,2026-05-19,BEL,6,6f,D,4,4.5,8,90,8",9+,94,109,93,
Harbor Sentinel,2026-06-14,BEL,3,1 1/8m,D,3,2.5,10,84,16-,,,,87,83
Harbor Sentinel,2026-07-10,GP,5,6f,D,4,3.5,9,,,9-,98,105,90,90
Harbor Sentinel,2026-08-05,GP,1,1 1/16m,D,3,2,9,85,15,15-,90,100,,85
Harbor Sentinel,2026-08-31,BEL,10,6f,D,3,3,7,88,,9,,104,92,87
Northbound Echo,2026-04-26,BEL,5,1 1/8m,D,6,6.5,7,97,9",10-,102,115,101,95
Northbound Echo,2026-05-22,KEE,9,1 1/16m,D,6,6.5,9,96,10",,100,,99,
Northbound Echo,2026-06-17,CD,9,1m,D,6,7,8,92,,,,109,95,
Northbound Echo,2026-07-13,GP,1,1m70y,D,4,4.5,9,97,9,8-,103,118,101,
Northbound Echo,2026-08-08,BEL,2,6 1/2f,T,3,3,7,93,9+,,95,109,,
Northbound Echo,2026-09-03,CD,6,1 1/8m,D,6,6,9,98,,9+,103,116,102,95
`;
  const SAMPLE_ENTRIES_CSV = `track,date,race,post,horse,ml,psr
SAR,2026-09-05,7,1,Iron Quill,8-1,92
SAR,2026-09-05,7,2,Copper Comet,2-1,103
SAR,2026-09-05,7,3,Lady Tempo,7-2,99
SAR,2026-09-05,7,4,Harbor Sentinel,12-1,86
SAR,2026-09-05,8,1,Northbound Echo,6-1,97
SAR,2026-09-05,8,2,Saratoga Whisper,9-5,100
SAR,2026-09-05,8,3,Rolling Thunderbay,5-1,95
SAR,2026-09-05,8,4,Midnight Ledger,3-1,101
`;
  if (typeof module === 'object' && module.exports) module.exports = SAMPLE_CSV;
  else { root.SAMPLE_CSV = SAMPLE_CSV; root.SAMPLE_ENTRIES_CSV = SAMPLE_ENTRIES_CSV; }
})(typeof self !== 'undefined' ? self : this);
