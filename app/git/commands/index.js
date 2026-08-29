const CatFileCommand = require("./cat-file");
const HashObjectCommand = require("./hash-object");
const LsTreeCommand = require("./ls-tree");
const WriteTreeCommand = require("./write-tree");
const CommitTreeCommand = require("./commit-tree");
const CloneCommand = require("./clone");
const RevParseCommand = require("./rev-parse");
const ShowRefCommand = require("./show-ref");
const UpdateRefCommand = require("./update-ref");
const SymbolicRefCommand = require("./symbolic-ref");
const LogCommand = require("./log");
const LsFilesCommand = require("./ls-files");
const CheckIgnoreCommand = require("./check-ignore");
const AddCommand = require("./add");
const RmCommand = require("./rm");
const StatusCommand = require("./status");
const CommitCommand = require("./commit");
const BranchCommand = require("./branch");
const CheckoutCommand = require("./checkout");
const TagCommand = require("./tag");
const DiffCommand = require("./diff");
const FetchCommand = require("./fetch");
const PushCommand = require("./push");
const MergeCommand = require("./merge");
module.exports = {
  CatFileCommand,
  HashObjectCommand,
  LsTreeCommand,
  WriteTreeCommand,
  CommitTreeCommand,
  CloneCommand,
  RevParseCommand,
  ShowRefCommand,
  UpdateRefCommand,
  SymbolicRefCommand,
  LogCommand,
  LsFilesCommand,
  CheckIgnoreCommand,
  AddCommand,
  RmCommand,
  StatusCommand,
  CommitCommand,
  BranchCommand,
  CheckoutCommand,
  TagCommand,
  DiffCommand,
  FetchCommand,
  PushCommand,
  MergeCommand,
};
