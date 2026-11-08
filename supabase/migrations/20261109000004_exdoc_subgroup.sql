-- Example Document: an optional subfolder inside a group (e.g. "ตัวอย่างเอกสารแนบบุริม"). Blank = directly in the group.
alter table exdocs add column subgroup text check (subgroup is null or char_length(subgroup) between 1 and 100);
