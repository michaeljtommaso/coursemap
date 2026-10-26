const U="https://catalog.cornell.edu/programs/earth-climate-sciences-ecsag-bs/";
const src=(a)=>({url:U,anchor:a});
const A="Environmental Science Focused Elective";
const seat=(id,label,course,credits)=>({id,label,group:"Core courses",source:src(A),kind:"seat",rule:{course:[course]},credits});
const layer={
 id:"cornell-earth-climate-sciences-ecsag-bs-2026--environmental-science",kind:"concentration",family:"cals",
 name:"Earth and Climate Sciences: Environmental Science",catalogYear:"2026-27",
 programId:"cornell-earth-climate-sciences-ecsag-bs-2026",concentrationId:"environmental-science",courseSharing:"shared",
 rows:[
  seat("env-core-earth-system","The Earth System (EAS 2250)","EAS-2250",4),
  seat("env-core-earth-materials","Earth Materials (EAS 3090)","EAS-3090",3),
  seat("env-core-biogeochemistry","Introduction to Biogeochemistry (EAS 3030)","EAS-3030",4),
  seat("env-core-groundwater","Introduction to Groundwater (EAS 4710)","EAS-4710",3),
  {id:"env-focused-electives",label:"Five courses from the environmental science elective list",group:"Focused electives",source:src(A),kind:"pool",rule:{list:"L9"},requiredCourses:5,requiredCredits:0},
  {id:"env-field-course",label:"Field course: Field Geophysics (EAS 4370)",group:"Field course",source:src(A),kind:"seat",rule:{course:["EAS-4370"]},note:"Students who meet the field requirement another way should use the confirm row below; this seat will then stay open.",credits:3},
  {id:"env-field-alternatives",label:"Field requirement met by an approved alternative (outside field course, field research with Cornell faculty or an REU, or EAS 4910/4920 research totaling three or more credits)",group:"Field course",source:src(A),kind:"confirm",note:"Needs advance approval from the faculty advisor and the EAS curriculum committee. Choosing a non-credit research option means taking one more EAS concentration course."}
 ]};
const q=(...a)=>a;
const d={schemaVersion:1,programId:layer.id,author:"a",model:"sonnet",framing:"row-by-row",
 snapshot:{url:U,textSha256:"006665d2aa2083b80ade13043a33a5c34a3928ca85a6d74d016d66e2afd6f57d"},layer,
 quotes:{
  "env-core-earth-system":["Environmental Science Core Required Courses-Must take all","EAS 2250 | The Earth System | 4"],
  "env-core-earth-materials":["Environmental Science Core Required Courses-Must take all","EAS 3090 | Earth Materials | 3"],
  "env-core-biogeochemistry":["Environmental Science Core Required Courses-Must take all","EAS 3030 | Introduction to Biogeochemistry | 4"],
  "env-core-groundwater":["Environmental Science Core Required Courses-Must take all","EAS 4710 | Introduction to Groundwater | 3"],
  "env-focused-electives":["Environmental Science Focused Elective Courses (5 courses)"],
  "env-field-course":["Environmental Science Focused Elective Field Courses","EAS 4370 Field Geophysics"],
  "env-field-alternatives":["Field courses offered by another college or university with prior advisor approval.","Experience gained participating in field research with Cornell faculty (or REU at another institution)","Advisor-approved Undergraduate Research (EAS 4910/EAS 4920) totaling at least three credits.","Requires pre-approval by the faculty advisor and the EAS Curriculum Committee.","Students using a non-credit research option for the field course requirement are required to complete an additional EAS concentration course."]
 },
 notes:["courseSharing is shared: the page has no sentence barring a concentration course from also counting toward the major, so nothing decides it for 'separate'.","EAS 4710 and EAS 3010/3050 appear on both the core and elective lists as the page prints them; the whole elective list is kept, and a course counts once within the layer, so EAS 4710 serves the core seat.","Field credit value of EAS 4370 is assumed 3; the page gives no credits for it.","Page lists the field requirement without a count; read as one field course (or approved alternative). Alternatives are advisor-approved so they are a confirm row; the EAS 4370 seat stays open for students using them.","Page 'Other field options' text was not copied; the major layer has its own concentration choice (1 of 4)."],
 derivedNumbers:{"genchem-intro-pair":"An &-pair means both listed courses (lecture and lab), so 2 courses.","genchem-one-pair":"An &-pair means both listed courses (lecture and lab), so 2 courses.","env-field-course":"The page lists one field course heading with a single option and the footnote speaks of 'the field course requirement' (singular), so one field course is required."}
};
require("fs").writeFileSync(process.argv[2],JSON.stringify(d,null,2));
