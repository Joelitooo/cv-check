export type Recommendation = "Apply" | "Maybe apply" | "Skip";

export interface SkillGroup {
  label: string;
  items: string;
}

export interface ExperienceRole {
  title: string;
  dates: string;
  bullets: string[];
}

export interface ExperienceEntry {
  company: string;
  location: string;
  roles: ExperienceRole[];
}

export interface EducationEntry {
  school: string;
  detail: string;
  dates: string;
}

export interface TailoredCv {
  headline: string;
  summary: string;
  skills: SkillGroup[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
}

export interface AnalysisResult {
  blocked: boolean;
  blockedReason?: string;
  company: string;
  role: string;
  location: string;
  seniority: string;
  recommendation: Recommendation;
  why: string;
  reportMarkdown: string;
  tailoredCv?: TailoredCv;
}

export interface CvFile {
  path: string;
  text: string;
  name: string;
  headline: string;
  contacts: string;
}
