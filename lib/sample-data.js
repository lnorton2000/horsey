/* Fictional horses and figures for demo purposes only. Generated, not real data. */
(function (root) {
  const SAMPLE_CSV = `
horse,date,track,race,distance,surface,beyer,ragozin,thorograph,brisnet,timeform,equibase,thoromanager
Copper Comet,2026-04-05,GP,6,6f,D,108,3+,3,,,113,103
Copper Comet,2026-05-01,SAR,10,6 1/2f,D,105,4",,109,127,110,101
Copper Comet,2026-05-27,AQU,5,1m,T,102,7,,107,123,105,100
Copper Comet,2026-06-22,AQU,1,7f,D,103,5+,5,106,122,106,
Copper Comet,2026-07-18,KEE,6,1 1/16m,D,101,7-,6,107,124,,100
Copper Comet,2026-08-13,SA,10,6f,D,104,4",4",108,122,105,
Midnight Ledger,2026-04-08,SAR,2,6 1/2f,D,,6",5",105,119,102,98
Midnight Ledger,2026-05-04,AQU,10,1m,D,96,9,9,100,115,100,93
Midnight Ledger,2026-05-30,SA,5,1 1/8m,D,94,,10+,98,113,99,91
Midnight Ledger,2026-06-25,CD,4,1m70y,D,97,8",8,,116,101,95
Midnight Ledger,2026-07-21,BEL,2,1 1/16m,D,102,8,8-,104,,102,98
Midnight Ledger,2026-08-16,KEE,6,1 1/8m,D,99,9+,8-,104,,103,97
Rolling Thunderbay,2026-04-11,SAR,1,1 1/8m,D,92,11",12+,99,,,
Rolling Thunderbay,2026-05-07,BEL,10,6f,D,94,9-,,97,110,,
Rolling Thunderbay,2026-06-02,BEL,2,6f,D,94,8-,8,96,109,96,91
Rolling Thunderbay,2026-06-28,KEE,10,1 1/16m,D,96,10,10-,,116,99,93
Rolling Thunderbay,2026-07-24,CD,1,1m70y,T,98,9+,,,118,,94
Rolling Thunderbay,2026-08-19,BEL,5,7f,D,94,8",9,,,96,91
Saratoga Whisper,2026-04-14,SA,5,6 1/2f,D,104,5-,5-,108,124,,102
Saratoga Whisper,2026-05-10,KEE,1,1m70y,D,103,7-,7,106,121,,99
Saratoga Whisper,2026-06-05,AQU,9,1 1/16m,D,103,7-,,,120,105,100
Saratoga Whisper,2026-07-01,GP,7,6 1/2f,T,100,7,7-,104,120,101,99
Saratoga Whisper,2026-07-27,CD,5,6 1/2f,T,99,5",6",105,118,102,97
Saratoga Whisper,2026-08-22,SA,7,1 1/8m,T,99,10+,10+,102,117,101,97
Iron Quill,2026-04-17,AQU,8,7f,D,89,10+,10,92,,91,87
Iron Quill,2026-05-13,BEL,5,1 1/8m,T,89,13",14-,,108,95,87
Iron Quill,2026-06-08,KEE,5,1 1/16m,D,97,10-,9",,117,101,94
Iron Quill,2026-07-04,BEL,1,7f,T,90,9",10+,96,106,92,91
Iron Quill,2026-07-30,BEL,8,6 1/2f,D,,,,99,,,91
Iron Quill,2026-08-25,SA,9,6 1/2f,T,90,9",,95,108,91,92
Lady Tempo,2026-04-20,SA,5,1m70y,D,90,10",11,,109,,
Lady Tempo,2026-05-16,AQU,2,1 1/8m,D,98,9,,103,116,102,98
Lady Tempo,2026-06-11,KEE,9,6 1/2f,D,94,7+,7-,,113,99,93
Lady Tempo,2026-07-07,BEL,8,6f,D,96,7+,6,102,117,,96
Lady Tempo,2026-08-02,KEE,2,1m70y,T,100,,8,104,,102,97
Lady Tempo,2026-08-28,KEE,5,6f,T,,6",5+,103,116,102,95
Harbor Sentinel,2026-04-23,CD,8,1 1/16m,D,92,10",,97,109,94,92
Harbor Sentinel,2026-05-19,SA,3,6 1/2f,D,88,10",10-,94,104,91,87
Harbor Sentinel,2026-06-14,GP,9,1 1/8m,D,95,12-,9",101,114,97,94
Harbor Sentinel,2026-07-10,CD,2,1 1/8m,D,91,14,14-,,107,91,
Harbor Sentinel,2026-08-05,BEL,5,1 1/8m,D,90,13+,12",96,104,94,90
Harbor Sentinel,2026-08-31,BEL,2,1 1/8m,D,88,15-,13",92,104,91,
Northbound Echo,2026-04-26,CD,3,7f,D,92,9,9",98,,99,92
Northbound Echo,2026-05-22,AQU,3,1 1/8m,D,94,12-,13,97,114,97,90
Northbound Echo,2026-06-17,KEE,1,6 1/2f,D,91,9-,10,96,107,95,90
Northbound Echo,2026-07-13,KEE,7,7f,D,89,12-,11",,106,88,85
Northbound Echo,2026-08-08,CD,4,6f,D,94,7+,7,99,,99,
Northbound Echo,2026-09-03,SA,4,1m70y,D,95,10+,9",,112,99,92
`;
  if (typeof module === 'object' && module.exports) module.exports = SAMPLE_CSV;
  else root.SAMPLE_CSV = SAMPLE_CSV;
})(typeof self !== 'undefined' ? self : this);
